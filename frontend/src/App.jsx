import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Calendar,
  Lock,
  Unlock,
  RefreshCw,
  Copy,
  Plus,
  Trash,
  Settings,
  Key,
  Check,
  CheckSquare,
  Square,
  Share2,
  LogOut,
  Search,
  ChefHat,
  ShoppingCart,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ExternalLink,
  Edit,
  Eye,
  EyeOff,
  MessageSquare
} from 'lucide-react';
import {
  getRotationForDate,
  SEED_BREAKFASTS,
  SEED_SNACKS,
  SEED_LUNCHES,
  getWeeksSinceBase
} from './seedData';

// Utility to strip HTML tags and decode HTML entities from Workflowy text values
function cleanText(text) {
  if (!text) return '';
  let cleaned = text.replace(/<[^>]*>/g, '');
  
  // Decode standard HTML entities
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'"
  };
  
  Object.entries(entities).forEach(([entity, replacement]) => {
    cleaned = cleaned.replaceAll(entity, replacement);
  });
  
  return cleaned.trim();
}

// Format date nicely (e.g., "May 30, 2026")
function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

// Get the Sunday of the active week for a given date
function getSundayOfCurrentWeek(d = new Date()) {
  const day = d.getDay();
  const diff = d.getDate() - day; // adjust when day is sunday
  const sunday = new Date(d.setDate(diff));
  sunday.setHours(0, 0, 0, 0);
  return sunday;
}

// Strictly sequential API request queue to prevent Workflowy 429 Rate Limits
let requestQueue = Promise.resolve();

export default function App() {
  // --- STATE ---
  const [proxyUrl, setProxyUrl] = useState(() => {
    const saved = localStorage.getItem('wf_proxy_url');
    if (saved) return saved;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:3001';
    }
    if (window.location.hostname.includes('github.io')) {
      return 'http://localhost:3001';
    }
    return window.location.origin;
  });
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('wf_api_key') || '');
  const [customFolderId, setCustomFolderId] = useState(() => localStorage.getItem('wf_custom_folder_id') || '');
  const [rootNodeId, setRootNodeId] = useState(() => localStorage.getItem('wf_root_node_id') || '');
  const [activeTab, setActiveTab] = useState('planner');
  const [isLoading, setIsLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState(null);
  
  // Mapping of Workflowy outline UUIDs once explored
  const [nodeMappings, setNodeMappings] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('wf_node_mappings')) || {};
    } catch {
      return {};
    }
  });

  // Master recipe database fetched from Workflowy
  const [recipes, setRecipes] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('wf_recipes')) || {
        breakfasts: [],
        lunches: [],
        snacks: [],
        dinners: { soon: [], while: [], new: [], recent: [] }
      };
    } catch {
      return {
        breakfasts: [],
        lunches: [],
        snacks: [],
        dinners: { soon: [], while: [], new: [], recent: [] }
      };
    }
  });

  // Dynamic ingredient lists cached by recipe ID (to avoid recursive fetch upfront)
  const [ingredientCache, setIngredientCache] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('wf_ingredient_cache')) || {};
    } catch {
      return {};
    }
  });

  // Dynamic instructions and full details cached by recipe ID (to avoid repeat fetches)
  const [detailsCache, setDetailsCache] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('wf_details_cache')) || {};
    } catch {
      return {};
    }
  });

  // Selected date range (weeks start on Sunday)
  const [selectedSunday, setSelectedSunday] = useState(() => {
    const defaultSun = getSundayOfCurrentWeek();
    return defaultSun.toISOString().split('T')[0];
  });

  // Active weekly menu planner grid state
  // Key format: "Monday-dinner", value is a recipe object
  const [weeklyMenu, setWeeklyMenu] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('wf_weekly_menu')) || {};
    } catch {
      return {};
    }
  });

  // Locked state for slots (to avoid rolls)
  const [lockedSlots, setLockedSlots] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('wf_locked_slots')) || {};
    } catch {
      return {};
    }
  });

  // Interactive UI state
  const [rollingSlots, setRollingSlots] = useState({});
  const [shoppingChecked, setShoppingChecked] = useState({});
  const [showSearchModal, setShowSearchModal] = useState(null); // { day, slot } or null
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRecipes, setExpandedRecipes] = useState({});
  const [loadingDetails, setLoadingDetails] = useState({});

  // Save critical states locally
  useEffect(() => {
    localStorage.setItem('wf_api_key', apiKey);
    localStorage.setItem('wf_custom_folder_id', customFolderId);
    localStorage.setItem('wf_root_node_id', rootNodeId);
    localStorage.setItem('wf_node_mappings', JSON.stringify(nodeMappings));
    localStorage.setItem('wf_recipes', JSON.stringify(recipes));
    localStorage.setItem('wf_ingredient_cache', JSON.stringify(ingredientCache));
    localStorage.setItem('wf_details_cache', JSON.stringify(detailsCache));
    localStorage.setItem('wf_weekly_menu', JSON.stringify(weeklyMenu));
    localStorage.setItem('wf_locked_slots', JSON.stringify(lockedSlots));
    localStorage.setItem('wf_proxy_url', proxyUrl);
  }, [apiKey, customFolderId, rootNodeId, nodeMappings, recipes, ingredientCache, detailsCache, weeklyMenu, lockedSlots, proxyUrl]);

  // Current date formatted beautifully
  const currentWeekLabel = useMemo(() => {
    const start = new Date(selectedSunday);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${formatDate(start)} – ${formatDate(end)}`;
  }, [selectedSunday]);

  // Days list & Slot Categories
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const slots = [
    { id: 'breakfast', label: 'Breakfast', color: 'badge-yellow' },
    { id: 'lunch', label: 'Lunch', color: 'badge-green' },
    { id: 'snack', label: 'Snack', color: 'badge-yellow' },
    { id: 'dinner', label: 'Dinner', color: 'badge-green' }
  ];

  // Initialize weekly grid based on spreadsheet rotations when date changes
  useEffect(() => {
    // If we change weeks, check if we already have a menu saved. If not, auto-seed with spreadsheet
    const newMenu = { ...weeklyMenu };
    let changed = false;

    // We fetch rotation baseline
    const rotation = getRotationForDate(selectedSunday);

    days.forEach(day => {
      // 1. Breakfast
      const bKey = `${day}-breakfast`;
      if (!newMenu[bKey]) {
        newMenu[bKey] = {
          id: `seed-b-${rotation.breakfast.id}`,
          name: rotation.breakfast.name,
          source: 'spreadsheet',
          category: 'breakfasts'
        };
        changed = true;
      }

      // 2. Lunch
      const lKey = `${day}-lunch`;
      if (!newMenu[lKey]) {
        newMenu[lKey] = {
          id: `seed-l-${rotation.lunch.id}`,
          name: rotation.lunch.name,
          source: 'spreadsheet',
          category: 'lunches'
        };
        changed = true;
      }

      // 3. Snack
      const sKey = `${day}-snack`;
      if (!newMenu[sKey]) {
        newMenu[sKey] = {
          id: `seed-s-${rotation.snack.id}`,
          name: rotation.snack.name,
          source: 'spreadsheet',
          category: 'snacks'
        };
        changed = true;
      }

      // 4. Dinner is left unselected or rolls on demand based on Option A
      const dKey = `${day}-dinner`;
      if (!newMenu[dKey]) {
        newMenu[dKey] = {
          id: '',
          name: 'Choose Dinner...',
          source: 'workflowy',
          category: 'dinners'
        };
        changed = true;
      }
    });

    if (changed) {
      setWeeklyMenu(newMenu);
    }
  }, [selectedSunday]);

  // --- WORKFLOWY API CLIENT ENGINES ---
  async function callWorkflowy(action, body) {
    const token = apiKey.trim();

    return new Promise((resolve, reject) => {
      requestQueue = requestQueue
        .then(async () => {
          // Enforce 200ms spacing between any consecutive requests
          await new Promise(r => setTimeout(r, 200));
          const cleanProxyUrl = proxyUrl.trim().replace(/\/+$/, '');
          const response = await fetch(`${cleanProxyUrl}/api/workflowy/${action}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(body)
          });
          if (!response.ok) {
            throw new Error(`Workflowy returned status ${response.status}`);
          }
          const data = await response.json();
          resolve(data);
        })
        .catch((err) => {
          reject(err);
          // Return a resolved value to keep the queue healthy and unblocked for subsequent requests
          return null;
        });
    });
  }

  // Find the primary node "Meal Planning🍴" and index its contents
  async function syncFromWorkflowy() {
    if (!apiKey) {
      alert('Please enter your Workflowy API key first!');
      return;
    }
    setIsLoading(true);
    setSyncMessage('Connecting to Workflowy root...');
    try {
      // Helper for deep recursive search
      async function findNodeDeeply(parentId, targetName, currentDepth = 0, maxDepth = 3) {
        if (currentDepth > maxDepth) return null;
        
        const response = await callWorkflowy('list-children', { item_id: parentId });
        const items = response.items || response.children || [];
        
        const match = items.find(item => cleanText(item.name).toLowerCase().includes(targetName.toLowerCase()));
        if (match) return match;
        
        for (const item of items) {
          if (item.is_completed || !item.name) continue;
          try {
            const found = await findNodeDeeply(item.id, targetName, currentDepth + 1, maxDepth);
            if (found) return found;
          } catch {
            // Ignore sub-outline list failures
          }
        }
        return null;
      }

      // 1. Fetch root items and search deeply (or use customFolderId directly if provided)
      let mealPlanningNode = null;
      const cleanCustomId = customFolderId ? customFolderId.trim().replace(/^.*\/#\//, '') : '';

      if (cleanCustomId) {
        setSyncMessage('Directly accessing custom Folder ID...');
        mealPlanningNode = { id: cleanCustomId, name: 'Meal Planning🍴' };
      } else {
        mealPlanningNode = await findNodeDeeply('None', 'Meal Planning', 0, 3);
      }

      if (!mealPlanningNode) {
        setIsLoading(false);
        alert('Could not find a node named "Meal Planning🍴" within the top 3 levels of your Workflowy. Please make sure the folder exists and is named correctly!');
        return;
      }

      setRootNodeId(mealPlanningNode.id);
      setSyncMessage('Folder located! Mapping outlines...');

      // 2. Fetch Meal Planning children to find Menu, Recipes, Shopping List
      const mealPlanningChildrenRes = await callWorkflowy('list-children', { item_id: mealPlanningNode.id });
      const subNodes = mealPlanningChildrenRes.items || mealPlanningChildrenRes.children || [];

      const mappings = {};
      subNodes.forEach(node => {
        const txt = cleanText(node.name).toLowerCase();
        if (txt.includes('recipe')) mappings.recipesId = node.id;
        else if (txt.includes('shopping') || txt.includes('grocery')) mappings.groceryId = node.id;
        else if (txt.includes('menu')) mappings.menuId = node.id;
      });

      if (!mappings.recipesId) {
        alert('Could not find a sub-bullet named "Recipes 📇" under your Meal Planning folder.');
        setIsLoading(false);
        return;
      }

      setNodeMappings(mappings);
      setSyncMessage('Recipes folder located! Pulling categories...');

      // 3. Fetch Recipe categories (Breakfasts, Lunches, Snacks, Dinners)
      const categoriesRes = await callWorkflowy('list-children', { item_id: mappings.recipesId });
      const categories = categoriesRes.items || categoriesRes.children || [];

      const parsedRecipes = {
        breakfasts: [],
        lunches: [],
        snacks: [],
        dinners: { soon: [], while: [], new: [], recent: [] }
      };

      for (const cat of categories) {
        const catName = cleanText(cat.name).toLowerCase();
        setSyncMessage(`Parsing ${cleanText(cat.name)}...`);
        
        const recipesRes = await callWorkflowy('list-children', { item_id: cat.id });
        const items = recipesRes.items || recipesRes.children || [];

        const cleanList = items.map(item => ({
          id: item.id,
          name: cleanText(item.name),
          note: item.description || ''
        }));

        if (catName.includes('breakfast')) {
          parsedRecipes.breakfasts = cleanList;
        } else if (catName.includes('lunch')) {
          parsedRecipes.lunches = cleanList;
        } else if (catName.includes('snack')) {
          parsedRecipes.snacks = cleanList;
        } else if (catName.includes('dinner')) {
          // Dinners are structured as nested status categories
          for (const statusCat of items) {
            const statusName = cleanText(statusCat.name).toLowerCase();
            const dinnerRecipesRes = await callWorkflowy('list-children', { item_id: statusCat.id });
            const dinnerItems = dinnerRecipesRes.items || dinnerRecipesRes.children || [];
            
            const dinnerList = dinnerItems.map(d => ({
              id: d.id,
              name: cleanText(d.name),
              note: d.description || ''
            }));

            if (statusName.includes('soon') || statusName.includes('thumbs')) {
              parsedRecipes.dinners.soon = dinnerList;
            } else if (statusName.includes('while') || statusName.includes('clock')) {
              parsedRecipes.dinners.while = dinnerList;
            } else if (statusName.includes('new') || statusName.includes('star')) {
              parsedRecipes.dinners.new = dinnerList;
            } else if (statusName.includes('recent') || statusName.includes('plate')) {
              parsedRecipes.dinners.recent = dinnerList;
            }
          }
        }
      }

      setRecipes(parsedRecipes);
      setSyncMessage('Successfully Synced with Workflowy!');
      setTimeout(() => setSyncMessage(null), 3000);
    } catch (e) {
      alert(`Sync failed: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  // Dynamic, on-demand loader for a selected recipe's ingredients to keep synchronization instant
  async function ensureIngredientsLoaded(recipe) {
    if (!recipe || !recipe.id || recipe.id.startsWith('seed-')) return [];
    if (ingredientCache[recipe.id]) return ingredientCache[recipe.id];

    console.log(`[Cache Miss] Loading ingredients for recipe: ${recipe.name}`);
    try {
      const response = await callWorkflowy('list-children', { item_id: recipe.id });
      const nodes = response.items || response.children || [];
      
      const ingredientsNode = nodes.find(node => cleanText(node.name).toLowerCase() === 'ingredients');
      if (ingredientsNode) {
        const ingredientsRes = await callWorkflowy('list-children', { item_id: ingredientsNode.id });
        const list = ingredientsRes.items || ingredientsRes.children || [];
        const cleanIngs = list.map(item => cleanText(item.name)).filter(Boolean);
        
        setIngredientCache(prev => ({
          ...prev,
          [recipe.id]: cleanIngs
        }));
        return cleanIngs;
      }
    } catch (e) {
      console.warn(`Failed to dynamically pull ingredients for: ${recipe.name}`, e);
    }
    return [];
  }

  // Dynamic, on-demand loader for a recipe's full details (ingredients and directions) to preview inside selection cards
  async function loadRecipeDetails(recipe) {
    if (!recipe || !recipe.id || recipe.id.startsWith('seed-')) return;
    if (detailsCache[recipe.id]) return;

    setLoadingDetails(prev => ({ ...prev, [recipe.id]: true }));
    try {
      // 1. Fetch direct children of the recipe node
      const response = await callWorkflowy('list-children', { item_id: recipe.id });
      const nodes = response.items || response.children || [];
      
      let ingredients = [];
      let instructions = [];

      // Find Ingredients node
      const ingredientsNode = nodes.find(node => {
        const name = cleanText(node.name).toLowerCase();
        return name === 'ingredients' || name.includes('grocery');
      });
      if (ingredientsNode) {
        const res = await callWorkflowy('list-children', { item_id: ingredientsNode.id });
        const list = res.items || res.children || [];
        ingredients = list.map(item => cleanText(item.name)).filter(Boolean);
      }

      // Find Directions/Instructions node
      const directionsNode = nodes.find(node => {
        const name = cleanText(node.name).toLowerCase();
        return name === 'directions' || name === 'instructions' || name === 'steps' || name.includes('recipe') || name.includes('method');
      });
      if (directionsNode) {
        const res = await callWorkflowy('list-children', { item_id: directionsNode.id });
        const list = res.items || res.children || [];
        instructions = list.map(item => cleanText(item.name)).filter(Boolean);
      }

      // Sync ingredients cache too
      if (ingredients.length > 0) {
        setIngredientCache(prev => ({
          ...prev,
          [recipe.id]: ingredients
        }));
      }

      setDetailsCache(prev => ({
        ...prev,
        [recipe.id]: {
          ingredients,
          instructions,
          note: recipe.note || ''
        }
      }));
    } catch (e) {
      console.warn(`Failed to load recipe details for: ${recipe.name}`, e);
    } finally {
      setLoadingDetails(prev => ({ ...prev, [recipe.id]: false }));
    }
  }

  // Pre-load ingredients for all selected recipes in the weekly menu in the background
  useEffect(() => {
    Object.values(weeklyMenu).forEach(recipe => {
      if (recipe && recipe.id && !recipe.id.startsWith('seed-')) {
        ensureIngredientsLoaded(recipe);
      }
    });
  }, [weeklyMenu]);

  // Consolidated and Deduplicated Grocery List
  const consolidatedGroceries = useMemo(() => {
    const list = [];
    // Deduplicate the weekly menu by recipe name to avoid processing the same meal multiple times
    const uniqueRecipes = [];
    const seenNames = new Set();
    
    Object.values(weeklyMenu).forEach(recipe => {
      if (!recipe || !recipe.name || recipe.name.includes('Choose')) return;
      const cleanName = recipe.name.trim().toLowerCase();
      if (!seenNames.has(cleanName)) {
        seenNames.add(cleanName);
        uniqueRecipes.push(recipe);
      }
    });

    uniqueRecipes.forEach(recipe => {
      if (!recipe.id) return;

      if (recipe.id.startsWith('seed-')) {
        // Fallback: If it's a seed meal, we search if we have a Workflowy equivalent matching by name
        // to grab ingredients, otherwise we list a generic placeholder
        const cleanCategory = recipe.category;
        const matchingRecipe = recipes[cleanCategory]?.find(r => cleanText(r.name).toLowerCase() === recipe.name.toLowerCase());
        
        if (matchingRecipe && ingredientCache[matchingRecipe.id]) {
          list.push(...ingredientCache[matchingRecipe.id].map(item => ({ item, source: recipe.name })));
        } else {
          // If no matches, we add a simple placeholder to remind them
          list.push({ item: `${recipe.name} ingredients`, source: recipe.name });
        }
      } else if (ingredientCache[recipe.id]) {
        list.push(...ingredientCache[recipe.id].map(item => ({ item, source: recipe.name })));
      }
    });

    // Deduplicate and group
    const uniqueMap = {};
    list.forEach(({ item, source }) => {
      const clean = item.trim();
      if (!clean || clean === '---' || clean.toLowerCase() === 'ingredients') return;
      if (!uniqueMap[clean.toLowerCase()]) {
        uniqueMap[clean.toLowerCase()] = {
          name: clean,
          sources: new Set()
        };
      }
      uniqueMap[clean.toLowerCase()].sources.add(source);
    });

    return Object.values(uniqueMap).map(g => ({
      name: g.name,
      sources: Array.from(g.sources).join(', ')
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [weeklyMenu, ingredientCache, recipes]);

  // --- GAMIFIED LOTTERY ENGINE ---
  function rollSlot(day, slot) {
    const key = `${day}-${slot}`;
    if (lockedSlots[key]) return; // locked

    setRollingSlots(prev => ({ ...prev, [key]: true }));

    setTimeout(() => {
      let pool = [];
      if (slot === 'breakfast') {
        // Pull from synced Workflowy breakfasts, falling back to seed database
        pool = recipes.breakfasts.length > 0 ? recipes.breakfasts : SEED_BREAKFASTS;
      } else if (slot === 'lunch') {
        pool = recipes.lunches.length > 0 ? recipes.lunches : SEED_LUNCHES;
      } else if (slot === 'snack') {
        pool = recipes.snacks.length > 0 ? recipes.snacks : SEED_SNACKS;
      } else if (slot === 'dinner') {
        // Option A Logic: Prioritize "Let's Eat This Soon"
        if (recipes.dinners.soon.length > 0) {
          pool = recipes.dinners.soon;
        } else {
          // Fallback to while + new
          pool = [...recipes.dinners.while, ...recipes.dinners.new];
        }
      }

      if (pool.length === 0) {
        setRollingSlots(prev => ({ ...prev, [key]: false }));
        return;
      }

      const randomRecipe = pool[Math.floor(Math.random() * pool.length)];

      setWeeklyMenu(prev => ({
        ...prev,
        [key]: {
          id: randomRecipe.id || `rolled-${slot}-${Date.now()}`,
          name: randomRecipe.name,
          source: randomRecipe.id ? 'workflowy' : 'seed',
          category: slot === 'dinner' ? 'dinners' : `${slot}s`
        }
      }));

      setRollingSlots(prev => ({ ...prev, [key]: false }));
    }, 600); // 600ms match standard roll CSS transition
  }

  // Roll all slots that are not locked
  function rollAllUnlocked() {
    days.forEach(day => {
      slots.forEach(slot => {
        rollSlot(day, slot.id);
      });
    });
  }

  // Toggle locked slot
  function toggleLock(day, slot) {
    const key = `${day}-${slot}`;
    setLockedSlots(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  }

  // Manual Select override
  function openSelector(day, slot) {
    setSearchQuery('');
    setShowSearchModal({ day, slot });
  }

  const filteredSearchList = useMemo(() => {
    if (!showSearchModal) return [];
    const { slot } = showSearchModal;
    let list = [];
    if (slot === 'breakfast') {
      list = recipes.breakfasts.length > 0 ? recipes.breakfasts : SEED_BREAKFASTS;
    } else if (slot === 'lunch') {
      list = recipes.lunches.length > 0 ? recipes.lunches : SEED_LUNCHES;
    } else if (slot === 'snack') {
      list = recipes.snacks.length > 0 ? recipes.snacks : SEED_SNACKS;
    } else if (slot === 'dinner') {
      list = [
        ...recipes.dinners.soon.map(d => ({ ...d, group: "Let's Eat This Soon 👍" })),
        ...recipes.dinners.while.map(d => ({ ...d, group: "It's Been a While 🕔" })),
        ...recipes.dinners.new.map(d => ({ ...d, group: "New / Never Made ✨" })),
        ...recipes.dinners.recent.map(d => ({ ...d, group: "Recently Made 🍽" }))
      ];
    }

    if (!searchQuery) return list;
    return list.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [showSearchModal, searchQuery, recipes]);

  function selectManualRecipe(item) {
    if (!showSearchModal) return;
    const { day, slot } = showSearchModal;
    const key = `${day}-${slot}`;
    setWeeklyMenu(prev => ({
      ...prev,
      [key]: {
        id: item.id || `manual-${slot}-${Date.now()}`,
        name: item.name,
        source: item.id ? 'workflowy' : 'seed',
        category: slot === 'dinner' ? 'dinners' : `${slot}s`
      }
    }));
    setShowSearchModal(null);
  }

  // --- WRITEBACK TO WORKFLOWY ---
  async function writeBackToWorkflowy() {
    if (!rootNodeId || !nodeMappings.menuId || !nodeMappings.groceryId) {
      alert('You must sync with your Workflowy account first to map the outlines!');
      return;
    }

    setIsLoading(true);
    setSyncMessage('Generating Weekly Plan outline in Workflowy...');

    try {
      const weekLabel = `Week of ${selectedSunday}`;

      // 1. Check if the week already exists in Menu for the Week, and delete it if so to avoid duplicates
      const menuChildrenRes = await callWorkflowy('list-children', { item_id: nodeMappings.menuId });
      const currentMenus = menuChildrenRes.items || menuChildrenRes.children || [];
      const oldWeekNode = currentMenus.find(m => cleanText(m.name).includes(weekLabel));
      if (oldWeekNode) {
        setSyncMessage('Updating existing week outline...');
        await callWorkflowy('delete-item', { item_id: oldWeekNode.id });
      }

      // 2. Create the main Week bullet in Menu for the Week
      const weekNodeRes = await callWorkflowy('create-item', {
        parent_id: nodeMappings.menuId,
        name: weekLabel,
        position: 'top'
      });
      const weekNodeId = weekNodeRes.id || weekNodeRes.item?.id;

      // 3. For each day, create bullets and populate meals
      for (const day of days) {
        setSyncMessage(`Writing schedule for ${day}...`);
        const dayNodeRes = await callWorkflowy('create-item', {
          parent_id: weekNodeId,
          name: day,
          position: 'bottom'
        });
        const dayNodeId = dayNodeRes.id || dayNodeRes.item?.id;

        for (const slot of slots) {
          const meal = weeklyMenu[`${day}-${slot.id}`];
          if (meal && meal.name && !meal.name.includes('Choose')) {
            // Incorporate original recipe deep-link in name if synced
            let bulletName = `${slot.label}: ${meal.name}`;
            if (meal.id && !meal.id.startsWith('seed-') && !meal.id.startsWith('rolled-') && !meal.id.startsWith('manual-')) {
              bulletName = `${slot.label}: <a href="https://workflowy.com/#/${meal.id}">${meal.name}</a> 🔗`;
            }

            await callWorkflowy('create-item', {
              parent_id: dayNodeId,
              name: bulletName,
              position: 'bottom'
            });
          }
        }
      }

      // 4. Update Grocery List: Check if Week folder already exists, remove it
      setSyncMessage('Writing consolidated groceries to Shopping List...');
      const groceryChildrenRes = await callWorkflowy('list-children', { item_id: nodeMappings.groceryId });
      const currentGroceries = groceryChildrenRes.items || groceryChildrenRes.children || [];
      const oldGrocNode = currentGroceries.find(g => cleanText(g.name).includes(weekLabel));
      if (oldGrocNode) {
        await callWorkflowy('delete-item', { item_id: oldGrocNode.id });
      }

      // Create a new dated Grocery sub-folder
      const grocWeekNodeRes = await callWorkflowy('create-item', {
        parent_id: nodeMappings.groceryId,
        name: `Grocery list for ${weekLabel}`,
        position: 'top'
      });
      const grocWeekNodeId = grocWeekNodeRes.id || grocWeekNodeRes.item?.id;

      // Write each consolidated item
      for (const groc of consolidatedGroceries) {
        // Create the parent ingredient bullet
        const grocNodeRes = await callWorkflowy('create-item', {
          parent_id: grocWeekNodeId,
          name: groc.name,
          position: 'bottom'
        });
        const grocNodeId = grocNodeRes.id || grocNodeRes.item?.id;

        // Split sources and create child bullets for each recipe context
        const sources = groc.sources.split(',').map(s => s.trim()).filter(Boolean);
        for (const src of sources) {
          await callWorkflowy('create-item', {
            parent_id: grocNodeId,
            name: src,
            position: 'bottom'
          });
        }
      }

      setSyncMessage('Successfully written back to Workflowy!');
      setTimeout(() => setSyncMessage(null), 3000);
      alert(`Hurray! Your menu and consolidated grocery list have been successfully generated and written directly into your Workflowy account under: \n\n1. Menu for the Week ➔ ${weekLabel}\n2. Shopping List ➔ Grocery list for ${weekLabel}`);
    } catch (e) {
      alert(`Writeback failed: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  // --- SHARING/COPY UTILITIES ---
  const shareableText = useMemo(() => {
    let text = `🍴 *OUR WEEKLY MENU* (${currentWeekLabel}) 🍴\n\n`;
    days.forEach(day => {
      text += `📅 *${day.toUpperCase()}*\n`;
      slots.forEach(slot => {
        const meal = weeklyMenu[`${day}-${slot.id}`];
        if (meal && meal.name && !meal.name.includes('Choose')) {
          const emoji = slot.id === 'breakfast' ? '🥞' : slot.id === 'lunch' ? '🥗' : slot.id === 'snack' ? '🥨' : '🍲';
          text += `  ${emoji} *${slot.label}:* ${cleanText(meal.name)}\n`;
        }
      });
      text += `\n`;
    });
    return text;
  }, [weeklyMenu, currentWeekLabel]);

  function copyToClipboard(txt, msg = 'Menu text copied!') {
    navigator.clipboard.writeText(txt);
    alert(msg);
  }

  // --- RENDER SCREENS ---
  return (
    <div className="container">
      {/* Header Bar */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ChefHat size={32} color="var(--primary)" />
          <div>
            <h1>Fresh Kitchen</h1>
            <p style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--secondary-dark)' }}>
              Menu & Shopping Planner
            </p>
          </div>
        </div>
        {apiKey && (
          <button 
            onClick={syncFromWorkflowy} 
            className="btn btn-outline" 
            style={{ minHeight: '36px', height: '36px', padding: '0 12px', width: 'auto', fontSize: '0.85rem' }}
            disabled={isLoading}
          >
            <RefreshCw size={14} className={isLoading ? 'spin-icon' : ''} />
            Sync
          </button>
        )}
      </header>

      {/* Sync Status Banner */}
      {syncMessage && (
        <div style={{
          background: 'var(--primary-light)',
          color: 'var(--primary-dark)',
          padding: '12px',
          borderRadius: 'var(--radius-md)',
          marginBottom: '20px',
          fontWeight: 600,
          textAlign: 'center',
          fontSize: '0.9rem',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <Sparkles size={16} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'text-bottom' }} />
          {syncMessage}
        </div>
      )}

      {/* Setup screen if API key is missing */}
      {!apiKey && (
        <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
          <ChefHat size={48} color="var(--primary)" style={{ margin: '0 auto 16px auto' }} />
          <h2 style={{ marginBottom: '8px', color: 'var(--primary-dark)' }}>Welcome to Fresh Kitchen!</h2>
          <p style={{ marginBottom: '24px' }}>
            We pull your breakfasts, lunches, and dinners dynamically from your Workflowy database to build your weekly planner.
          </p>

          <div className="input-group" style={{ textAlign: 'left', marginBottom: '20px' }}>
            <label className="input-label">Workflowy API Key</label>
            <input
              type="password"
              placeholder="wfpak_..."
              className="input-text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p style={{ fontSize: '0.75rem', marginTop: '4px' }}>
              Generate your token in settings: <a href="https://workflowy.com/api-key/" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>workflowy.com/api-key ➔</a>
            </p>
          </div>

          <div className="input-group" style={{ textAlign: 'left', marginBottom: '24px' }}>
            <label className="input-label">Workflowy Folder ID (Optional)</label>
            <input
              type="text"
              placeholder="e.g. 1a51710e-87a0-c3de-5a2c-7af2651a82d0"
              className="input-text"
              value={customFolderId}
              onChange={(e) => setCustomFolderId(e.target.value)}
            />
            <p style={{ fontSize: '0.75rem', marginTop: '4px', color: 'var(--text-muted)' }}>
              If your <b>Meal Planning🍴</b> folder is deeply nested under sub-bullets, paste its bullet link or ID here to bypass searching.
            </p>
          </div>

          <button className="btn btn-primary" onClick={syncFromWorkflowy} disabled={isLoading}>
            <Key size={18} />
            Connect & Retrieve Recipes
          </button>
        </div>
      )}

      {/* Main Tabs Navigation */}
      {apiKey && (
        <div style={{ display: 'flex', gap: '8px', background: 'white', padding: '4px', borderRadius: 'var(--radius-lg)', marginBottom: '24px', border: '1px solid var(--border)' }}>
          <button 
            className={`btn ${activeTab === 'planner' ? 'btn-primary' : 'btn-outline'}`} 
            style={{ flex: 1, minHeight: '40px', padding: '8px 12px', fontSize: '0.9rem', borderRadius: 'var(--radius-md)' }}
            onClick={() => setActiveTab('planner')}
          >
            <Calendar size={16} /> Planner
          </button>
          <button 
            className={`btn ${activeTab === 'groceries' ? 'btn-primary' : 'btn-outline'}`} 
            style={{ flex: 1, minHeight: '40px', padding: '8px 12px', fontSize: '0.9rem', borderRadius: 'var(--radius-md)' }}
            onClick={() => setActiveTab('groceries')}
          >
            <ShoppingCart size={16} /> Shopping ({consolidatedGroceries.length})
          </button>
          <button 
            className={`btn ${activeTab === 'share' ? 'btn-primary' : 'btn-outline'}`} 
            style={{ flex: 1, minHeight: '40px', padding: '8px 12px', fontSize: '0.9rem', borderRadius: 'var(--radius-md)' }}
            onClick={() => setActiveTab('share')}
          >
            <Share2 size={16} /> Share
          </button>
          <button 
            className={`btn ${activeTab === 'settings' ? 'btn-primary' : 'btn-outline'}`} 
            style={{ flex: 1, minHeight: '40px', padding: '8px 12px', fontSize: '0.9rem', borderRadius: 'var(--radius-md)' }}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={16} /> Config
          </button>
        </div>
      )}

      {/* TAB: PLANNER */}
      {apiKey && activeTab === 'planner' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Week Selector Grid */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <button 
              className="btn btn-outline" 
              style={{ width: 'auto', minHeight: '36px', height: '36px', padding: '0 10px' }}
              onClick={() => {
                const prev = new Date(selectedSunday);
                prev.setDate(prev.getDate() - 7);
                setSelectedSunday(prev.toISOString().split('T')[0]);
              }}
            >
              <ChevronLeft size={18} />
            </button>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Active Week</span>
              <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--primary-dark)' }}>{currentWeekLabel}</div>
            </div>
            <button 
              className="btn btn-outline" 
              style={{ width: 'auto', minHeight: '36px', height: '36px', padding: '0 10px' }}
              onClick={() => {
                const next = new Date(selectedSunday);
                next.setDate(next.getDate() + 7);
                setSelectedSunday(next.toISOString().split('T')[0]);
              }}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Quick Roll Button */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-secondary" onClick={rollAllUnlocked} style={{ flex: 1 }}>
              <RefreshCw size={18} />
              Roll All Unlocked
            </button>
          </div>

          {/* Daily Schedule Cards */}
          {days.map(day => (
            <div key={day} className="card card-primary" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                <h3 style={{ color: 'var(--primary-dark)', fontWeight: 800 }}>{day}</h3>
                <span className="badge badge-green" style={{ fontSize: '0.7rem' }}>Suggested Rotation</span>
              </div>

              {/* Breakfast, Lunch, Snack, Dinner Slots */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {slots.map(slot => {
                  const key = `${day}-${slot.id}`;
                  const recipe = weeklyMenu[key] || { name: 'Choose...' };
                  const isLocked = lockedSlots[key];
                  const isRolling = rollingSlots[key];

                  return (
                    <div key={slot.id} className={`slot-container ${isLocked ? 'locked' : ''}`}>
                      <div className="slot-info" onClick={() => openSelector(day, slot.id)}>
                        <div className="slot-label">{slot.label}</div>
                        <div className={`slot-value ${isRolling ? 'rolling' : ''}`}>
                          {cleanText(recipe.name)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {/* Lock Toggle */}
                        <button 
                          onClick={() => toggleLock(day, slot.id)} 
                          style={{
                            padding: '8px',
                            color: isLocked ? 'var(--primary-dark)' : 'var(--text-muted)',
                            borderRadius: 'var(--radius-sm)',
                            background: isLocked ? 'rgba(16, 185, 129, 0.1)' : 'transparent'
                          }}
                        >
                          {isLocked ? <Lock size={16} /> : <Unlock size={16} />}
                        </button>
                        {/* Roll Toggle */}
                        <button 
                          onClick={() => rollSlot(day, slot.id)} 
                          disabled={isLocked}
                          style={{
                            padding: '8px',
                            color: isLocked ? '#cbd5e1' : 'var(--secondary-dark)',
                            borderRadius: 'var(--radius-sm)',
                            background: isLocked ? 'transparent' : 'var(--secondary-light)'
                          }}
                        >
                          <RefreshCw size={16} className={isRolling ? 'spin-icon' : ''} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Sticky Bottom Writeback bar */}
          <div className="bottom-tray">
            <button className="btn btn-primary" onClick={writeBackToWorkflowy} disabled={isLoading}>
              <Plus size={20} />
              Save Week to Workflowy
            </button>
          </div>

        </div>
      )}

      {/* TAB: SHOPPING LIST */}
      {apiKey && activeTab === 'groceries' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ color: 'var(--primary-dark)' }}>Grocery Shopping List</h2>
                <p>Consolidated ingredients for your menu</p>
              </div>
              <button 
                className="btn btn-outline" 
                style={{ width: 'auto', padding: '0 12px', minHeight: '36px', height: '36px' }}
                onClick={() => {
                  const txt = consolidatedGroceries.map(g => `• ${g.name} (${g.sources})`).join('\n');
                  copyToClipboard(txt, 'Grocery list copied for texting!');
                }}
              >
                <Copy size={16} /> Copy List
              </button>
            </div>

            {consolidatedGroceries.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '24px 0' }}>No meals planned yet. Go schedule some in the planner tab!</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {consolidatedGroceries.map(groc => {
                  const isChecked = shoppingChecked[groc.name];
                  return (
                    <div 
                      key={groc.name} 
                      onClick={() => setShoppingChecked(prev => ({ ...prev, [groc.name]: !isChecked }))}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 14px',
                        background: isChecked ? '#f5f5f4' : '#ffffff',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        textDecoration: isChecked ? 'line-through' : 'none',
                        color: isChecked ? 'var(--text-muted)' : 'var(--text-main)',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {isChecked ? <CheckSquare size={20} color="var(--primary)" /> : <Square size={20} color="var(--text-muted)" />}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{groc.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>For: {cleanText(groc.sources)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: SHARE VIEW */}
      {apiKey && activeTab === 'share' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Share instructions card */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h2 style={{ color: 'var(--primary-dark)' }}>Share Weekly Menu</h2>
            <p>Screenshot the card below to send to each other, or copy the formatted text directly for a text message!</p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <button className="btn btn-secondary" onClick={() => copyToClipboard(shareableText)} style={{ flex: 1 }}>
                <MessageSquare size={18} />
                Copy Text Message
              </button>
            </div>
          </div>

          {/* Screenshot-ready Premium Visual Card Mock */}
          <div style={{
            background: 'linear-gradient(135deg, #10b981 0%, #047857 100%)',
            padding: '24px 16px',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--shadow-lg)',
            color: 'white',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div style={{ textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: '14px' }}>
              <h2 style={{ fontSize: '1.6rem', color: '#fbbf24', fontWeight: 800 }}>🌿 Fresh Kitchen Menu 🍋</h2>
              <span style={{ fontSize: '0.8rem', opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                {currentWeekLabel}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {days.map(day => {
                const bMeal = cleanText(weeklyMenu[`${day}-breakfast`]?.name || '---');
                const lMeal = cleanText(weeklyMenu[`${day}-lunch`]?.name || '---');
                const dMeal = cleanText(weeklyMenu[`${day}-dinner`]?.name || '---');

                return (
                  <div key={day} style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-lg)'
                  }}>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fef3c7', marginBottom: '6px', borderBottom: '1px dashed rgba(255,255,255,0.15)', paddingBottom: '2px' }}>
                      {day}
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.9rem' }}>
                      {bMeal && !bMeal.includes('Choose') && (
                        <div>🥐 <strong style={{ color: '#fef3c7' }}>Breakfast:</strong> {bMeal}</div>
                      )}
                      {lMeal && !lMeal.includes('Choose') && (
                        <div>🥗 <strong style={{ color: '#fef3c7' }}>Lunch:</strong> {lMeal}</div>
                      )}
                      {dMeal && !dMeal.includes('Choose') && (
                        <div>🍲 <strong style={{ color: '#fbbf24' }}>Dinner:</strong> {dMeal}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ textAlign: 'center', fontSize: '0.75rem', opacity: 0.8, marginTop: '8px' }}>
              Generated from our Workflowy database with 💚
            </div>
          </div>
        </div>
      )}

      {/* TAB: SETTINGS & CONFIG */}
      {apiKey && activeTab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h2 style={{ color: 'var(--primary-dark)' }}>Developer Settings</h2>
            
            <div className="input-group">
              <label className="input-label">Active API Key</label>
              <input 
                type="password" 
                className="input-text" 
                value={apiKey} 
                onChange={(e) => setApiKey(e.target.value)} 
              />
            </div>

            <div className="input-group">
              <label className="input-label">Workflowy Folder ID (Optional)</label>
              <input 
                type="text" 
                className="input-text" 
                value={customFolderId} 
                onChange={(e) => setCustomFolderId(e.target.value)} 
                placeholder="e.g. 1a51710e-87a0-c3de-5a2c-7af2651a82d0"
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                If your folder is deeply nested and recursive sync fails, paste the URL or ID of your "Meal Planning🍴" bullet here!
              </p>
            </div>

            <div className="input-group">
              <label className="input-label">Proxy Server URL</label>
              <input 
                type="text" 
                className="input-text" 
                value={proxyUrl} 
                onChange={(e) => setProxyUrl(e.target.value)} 
                placeholder="http://localhost:3001"
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Set to <code>http://localhost:3001</code> for your local terminal, or enter your Render/Railway backend URL for 100% cloud access!
              </p>
            </div>

            <div style={{ padding: '14px', background: '#fafaf9', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '6px', color: 'var(--primary-dark)' }}>Workflowy Node Mappings:</div>
              <div><strong>Root node:</strong> <code>{rootNodeId || 'None'}</code></div>
              <div><strong>Recipes folder:</strong> <code>{nodeMappings.recipesId || 'Missing'}</code></div>
              <div><strong>Grocery folder:</strong> <code>{nodeMappings.groceryId || 'Missing'}</code></div>
              <div><strong>Weekly menus:</strong> <code>{nodeMappings.menuId || 'Missing'}</code></div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button 
                className="btn btn-outline" 
                style={{ flex: 1 }}
                onClick={() => {
                  if (confirm('Clear all stored planner data and API key?')) {
                    localStorage.clear();
                    window.location.reload();
                  }
                }}
              >
                <Trash size={16} /> Clear Stored Data
              </button>
              <button 
                className="btn btn-primary" 
                style={{ flex: 1 }}
                onClick={syncFromWorkflowy}
              >
                <RefreshCw size={16} /> Re-Sync outline
              </button>
            </div>

            <button 
              className="btn btn-outline" 
              style={{ color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.2)', background: '#fef2f2' }}
              onClick={() => {
                setApiKey('');
                setRootNodeId('');
                setNodeMappings({});
                setRecipes({ breakfasts: [], lunches: [], snacks: [], dinners: { soon: [], while: [], new: [], recent: [] } });
              }}
            >
              <LogOut size={16} /> Disconnect Workflowy Account
            </button>
          </div>
        </div>
      )}

      {/* OVERLAY MODAL: MANUAL SEARCH & SELECT */}
      {showSearchModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          zIndex: 1000,
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)'
        }}>
          <div className="card" style={{ width: '100%', maxWidth: '400px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: '16px', background: 'white' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '10px', marginBottom: '12px' }}>
              <h3 style={{ color: 'var(--primary-dark)', fontWeight: 800 }}>
                Select {showSearchModal.slot.charAt(0).toUpperCase() + showSearchModal.slot.slice(1)}
              </h3>
              <button onClick={() => setShowSearchModal(null)} style={{ fontWeight: 800, fontSize: '1.2rem', padding: '4px', color: 'var(--text-muted)' }}>×</button>
            </div>

            {/* Search Input */}
            <div style={{ position: 'relative', marginBottom: '12px' }}>
              <input
                type="text"
                placeholder="Search recipe name..."
                className="input-text"
                style={{ paddingLeft: '36px' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '16px' }} />
            </div>

            {/* Results list */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredSearchList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>No recipes found</div>
              ) : (
                filteredSearchList.map(item => {
                  const activeDays = Array.from(new Set(
                    Object.entries(weeklyMenu)
                      .filter(([key, val]) => val && val.name && val.name.trim().toLowerCase() === item.name.trim().toLowerCase())
                      .map(([key]) => key.split('-')[0])
                  ));

                  const isExpanded = expandedRecipes[item.id];
                  const hasWorkflowyId = item.id && !item.id.startsWith('seed-');

                  return (
                    <div 
                      key={item.id} 
                      onClick={() => selectManualRecipe(item)}
                      style={{
                        padding: '12px 14px',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        background: '#fafaf9',
                        transition: 'all 0.1s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
                      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
                    >
                      {/* Top Header Row (Name + Actions) */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.95rem', lineHeight: 1.3 }}>{cleanText(item.name)}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                            {item.group && (
                              <span className="badge badge-yellow" style={{ fontSize: '0.65rem' }}>{item.group}</span>
                            )}
                            {activeDays.length > 0 && (
                              <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>
                                📅 Chosen: {activeDays.join(', ')}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Action Buttons */}
                        {hasWorkflowyId && (
                          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                            {/* Eyeball Preview Button */}
                            <button
                              title="Preview recipe details"
                              onClick={() => {
                                const newExpanded = !isExpanded;
                                setExpandedRecipes(prev => ({ ...prev, [item.id]: newExpanded }));
                                if (newExpanded) {
                                  loadRecipeDetails(item);
                                }
                              }}
                              style={{
                                padding: '6px',
                                borderRadius: 'var(--radius-sm)',
                                background: isExpanded ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
                                color: isExpanded ? 'var(--primary-dark)' : 'var(--text-muted)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                              }}
                            >
                              {isExpanded ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>

                            {/* Edit in Workflowy Button */}
                            <a
                              href={`https://workflowy.com/#/${item.id}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Edit in Workflowy"
                              style={{
                                padding: '6px',
                                borderRadius: 'var(--radius-sm)',
                                color: 'var(--text-muted)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'color 0.15s ease'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--secondary-dark)'}
                              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                            >
                              <Edit size={16} />
                            </a>
                          </div>
                        )}
                      </div>

                      {/* Expanded Preview Panel */}
                      {isExpanded && (
                        <div style={{
                          marginTop: '6px',
                          padding: '12px',
                          background: '#ffffff',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border)',
                          fontSize: '0.85rem',
                          color: 'var(--text-main)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '10px'
                        }} onClick={(e) => e.stopPropagation()}>
                          {loadingDetails[item.id] ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                              <RefreshCw size={14} className="spin-icon" /> Pulling details from Workflowy...
                            </div>
                          ) : (
                            <>
                              {/* Description/Note */}
                              {(item.note || (detailsCache[item.id] && detailsCache[item.id].note)) && (
                                <div>
                                  <div style={{ fontWeight: 700, color: 'var(--primary-dark)', marginBottom: '2px', fontSize: '0.8rem', textTransform: 'uppercase' }}>Description Note:</div>
                                  <div style={{ fontStyle: 'italic', color: 'var(--text-muted)', lineHeight: 1.3 }}>
                                    {item.note || detailsCache[item.id]?.note}
                                  </div>
                                </div>
                              )}

                              {/* Ingredients */}
                              {((detailsCache[item.id] && detailsCache[item.id].ingredients.length > 0) || (ingredientCache[item.id] && ingredientCache[item.id].length > 0)) ? (
                                <div>
                                  <div style={{ fontWeight: 700, color: 'var(--primary-dark)', marginBottom: '2px', fontSize: '0.8rem', textTransform: 'uppercase' }}>Ingredients:</div>
                                  <ul style={{ paddingLeft: '16px', margin: 0, display: 'flex', flexDirection: 'column', gap: '2px', lineHeight: 1.3 }}>
                                    {(detailsCache[item.id]?.ingredients || ingredientCache[item.id] || []).map((ing, idx) => (
                                      <li key={idx}>{ing}</li>
                                    ))}
                                  </ul>
                                </div>
                              ) : (
                                <div>
                                  <div style={{ fontWeight: 700, color: 'var(--primary-dark)', marginBottom: '2px', fontSize: '0.8rem', textTransform: 'uppercase' }}>Ingredients:</div>
                                  <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No ingredients found.</div>
                                </div>
                              )}

                              {/* Directions */}
                              {detailsCache[item.id] && detailsCache[item.id].instructions.length > 0 ? (
                                <div>
                                  <div style={{ fontWeight: 700, color: 'var(--primary-dark)', marginBottom: '2px', fontSize: '0.8rem', textTransform: 'uppercase' }}>Directions:</div>
                                  <ol style={{ paddingLeft: '16px', margin: 0, display: 'flex', flexDirection: 'column', gap: '4px', lineHeight: 1.3 }}>
                                    {detailsCache[item.id].instructions.map((step, idx) => (
                                      <li key={idx}>{step}</li>
                                    ))}
                                  </ol>
                                </div>
                              ) : (
                                detailsCache[item.id] && (
                                  <div>
                                    <div style={{ fontWeight: 700, color: 'var(--primary-dark)', marginBottom: '2px', fontSize: '0.8rem', textTransform: 'uppercase' }}>Directions:</div>
                                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No directions found in sub-bullets.</div>
                                  </div>
                                )
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
      {/* Version Footer */}
      <footer style={{
        textAlign: 'center',
        marginTop: '32px',
        paddingTop: '16px',
        borderTop: '1px solid var(--border)',
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        opacity: 0.8
      }}>
        v1.1.1 • Built on May 30, 2026 at 10:20 AM CT
      </footer>
    </div>
  );
}
