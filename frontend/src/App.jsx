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
  let cleaned = text;
  
  // Decode standard HTML entities (double-pass to handle double encoding like &amp;amp;)
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'"
  };
  
  for (let i = 0; i < 2; i++) {
    Object.entries(entities).forEach(([entity, replacement]) => {
      cleaned = cleaned.replaceAll(entity, replacement);
    });
  }
  
  // Strip HTML tags after decoding entities (so tags like &lt;b&gt; are correctly cleaned)
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  
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

// Get the Friday of the active week (Friday to Thursday) for a given date
function getFridayOfCurrentWeek(d = new Date()) {
  const dateObj = new Date(d);
  const day = dateObj.getDay();
  const diff = (day >= 5) ? (day - 5) : (day + 2);
  const friday = new Date(dateObj.setDate(dateObj.getDate() - diff));
  friday.setHours(0, 0, 0, 0);
  return friday;
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
  const [weeklyPlanFolder, setWeeklyPlanFolder] = useState(() => localStorage.getItem('wf_weekly_plan_folder') || '');
  const [rootNodeId, setRootNodeId] = useState(() => localStorage.getItem('wf_root_node_id') || '');
  const [activeTab, setActiveTab] = useState('planner');
  const [isLoading, setIsLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState(null);
  
  // Google Calendar States
  const [googleClientId, setGoogleClientId] = useState(() => localStorage.getItem('wf_google_client_id') || '');
  const [googleAccessToken, setGoogleAccessToken] = useState('');
  const [googleCalendars, setGoogleCalendars] = useState([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState(() => localStorage.getItem('wf_google_selected_calendar_id') || 'primary');
  const [dinnerTime, setDinnerTime] = useState(() => localStorage.getItem('wf_dinner_time') || '18:00');

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

  // Dynamic groceries currently active in the Workflowy outlines
  const [workflowyGroceries, setWorkflowyGroceries] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('wf_workflowy_groceries')) || [];
    } catch {
      return [];
    }
  });

  // Selected date range (weeks start on Friday)
  const [selectedFriday, setSelectedFriday] = useState(() => {
    const defaultFri = getFridayOfCurrentWeek();
    
    // If today is Thursday (4), auto-advance to next week on startup
    const currentDay = new Date().getDay();
    if (currentDay === 4) {
      defaultFri.setDate(defaultFri.getDate() + 7);
    }
    
    return defaultFri.toISOString().split('T')[0];
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
  const [isRollingAll, setIsRollingAll] = useState(false);
  const [cloudSyncState, setCloudSyncState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [shoppingChecked, setShoppingChecked] = useState({});
  const [showSearchModal, setShowSearchModal] = useState(null); // { day, slot } or null
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRecipes, setExpandedRecipes] = useState({});
  const [loadingDetails, setLoadingDetails] = useState({});

  // Save critical states locally
  useEffect(() => {
    localStorage.setItem('wf_api_key', apiKey);
    localStorage.setItem('wf_custom_folder_id', customFolderId);
    localStorage.setItem('wf_weekly_plan_folder', weeklyPlanFolder);
    localStorage.setItem('wf_root_node_id', rootNodeId);
    localStorage.setItem('wf_node_mappings', JSON.stringify(nodeMappings));
    localStorage.setItem('wf_recipes', JSON.stringify(recipes));
    localStorage.setItem('wf_ingredient_cache', JSON.stringify(ingredientCache));
    localStorage.setItem('wf_details_cache', JSON.stringify(detailsCache));
    localStorage.setItem('wf_workflowy_groceries', JSON.stringify(workflowyGroceries));
    localStorage.setItem('wf_weekly_menu', JSON.stringify(weeklyMenu));
    localStorage.setItem('wf_locked_slots', JSON.stringify(lockedSlots));
    localStorage.setItem('wf_proxy_url', proxyUrl);
    localStorage.setItem('wf_google_client_id', googleClientId);
    localStorage.setItem('wf_google_selected_calendar_id', selectedCalendarId);
    localStorage.setItem('wf_dinner_time', dinnerTime);
  }, [apiKey, customFolderId, weeklyPlanFolder, rootNodeId, nodeMappings, recipes, ingredientCache, detailsCache, workflowyGroceries, weeklyMenu, lockedSlots, proxyUrl, googleClientId, selectedCalendarId, dinnerTime]);

  // Load Google Identity Services SDK dynamically
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
    
    return () => {
      const existingScript = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (existingScript) {
        document.body.removeChild(existingScript);
      }
    };
  }, []);

  // Fetch Google Calendars once we have an access token
  useEffect(() => {
    if (googleAccessToken) {
      fetchCalendars(googleAccessToken);
    }
  }, [googleAccessToken]);

  const handleAuthorize = () => {
    if (!googleClientId) {
      alert('Please enter your Google OAuth Client ID first inside the Config tab!');
      setActiveTab('settings');
      return;
    }
    
    try {
      if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
        alert('Google Identity Services SDK is still loading. Please try again in a few seconds.');
        return;
      }
      
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
        callback: (response) => {
          if (response.error) {
            console.error('Google Auth error:', response);
            alert(`Auth failed: ${response.error_description || response.error}`);
            return;
          }
          if (response.access_token) {
            setGoogleAccessToken(response.access_token);
            setSyncMessage({ type: 'success', text: 'Connected to Google Calendar successfully!' });
            setTimeout(() => setSyncMessage(null), 3000);
          }
        },
      });
      client.requestAccessToken();
    } catch (err) {
      console.error('OAuth initialization failed:', err);
      alert(`OAuth failed: ${err.message}`);
    }
  };

  const fetchCalendars = async (token) => {
    setIsLoading(true);
    try {
      const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to fetch calendars');
      }
      
      const data = await res.json();
      const items = data.items || [];
      setGoogleCalendars(items);
      
      // Auto-select primary or first calendar
      if (!selectedCalendarId || !items.find(c => c.id === selectedCalendarId)) {
        const primaryCal = items.find(c => c.primary) || items[0];
        if (primaryCal) {
          setSelectedCalendarId(primaryCal.id);
        }
      }
    } catch (err) {
      console.error('Error fetching calendars:', err);
      setSyncMessage({ type: 'error', text: `Failed to fetch calendars: ${err.message}` });
    } finally {
      setIsLoading(false);
    }
  };

  const formatICSDate = (date) => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
  };

  const exportWeekToICS = () => {
    try {
      const [hours, minutes] = dinnerTime.split(':').map(Number);
      const timestamp = formatICSDate(new Date());
      let icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Fresh Kitchen Planner//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH'
      ];
      
      let addedEvents = 0;
      
      for (const day of days) {
        const mealKey = `${day}-dinner`;
        const meal = weeklyMenu[mealKey];
        if (!meal || !meal.name || meal.name.includes('Choose')) {
          continue;
        }
        
        const d = getDayDate(day);
        const startEventDate = new Date(d);
        startEventDate.setHours(hours, minutes, 0, 0);
        
        const endEventDate = new Date(startEventDate);
        endEventDate.setHours(startEventDate.getHours() + 1);
        
        const cleanMealName = cleanText(meal.name);
        const hasWorkflowyId = meal.id && !meal.id.startsWith('seed-') && !meal.id.startsWith('rolled-') && !meal.id.startsWith('manual-');
        const wfLink = hasWorkflowyId ? `https://workflowy.com/#/${meal.id}` : '';
        
        const uid = `dinner-${day}-${selectedFriday}-${startEventDate.getTime()}@freshkitchenplanner.com`;
        
        let descParts = [
          `Scheduled Dinner: ${cleanMealName}`,
          wfLink ? `Workflowy Recipe Link: ${wfLink}` : '',
          `Generated by Fresh Kitchen Planner 🍴`
        ].filter(Boolean);
        
        const descEscaped = descParts.join('\\n\\n');
        
        icsContent.push('BEGIN:VEVENT');
        icsContent.push(`UID:${uid}`);
        icsContent.push(`DTSTAMP:${timestamp}`);
        icsContent.push(`DTSTART:${formatICSDate(startEventDate)}`);
        icsContent.push(`DTEND:${formatICSDate(endEventDate)}`);
        icsContent.push(`SUMMARY:🍲 Dinner: ${cleanMealName}`);
        icsContent.push(`DESCRIPTION:${descEscaped}`);
        icsContent.push('END:VEVENT');
        
        addedEvents++;
      }
      
      if (addedEvents === 0) {
        alert('No dinners have been scheduled for this week yet. Go schedule dinners in your planner!');
        return;
      }
      
      icsContent.push('END:VCALENDAR');
      
      const icsString = icsContent.join('\r\n');
      const blob = new Blob([icsString], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `dinners-week-of-${selectedFriday}.ics`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      setSyncMessage({ 
        type: 'success', 
        text: `Exported ${addedEvents} dinners to .ics file successfully!` 
      });
      setTimeout(() => setSyncMessage(null), 4000);
    } catch (err) {
      console.error('Error exporting ICS:', err);
      alert(`Export failed: ${err.message}`);
    }
  };

  const getSyncWindowFridays = () => {
    const today = new Date();
    const currentFri = getFridayOfCurrentWeek(today);
    
    const lastFri = new Date(currentFri);
    lastFri.setDate(lastFri.getDate() - 7);
    
    const nextFri = new Date(currentFri);
    nextFri.setDate(nextFri.getDate() + 7);
    
    return [
      lastFri.toISOString().split('T')[0],
      currentFri.toISOString().split('T')[0],
      nextFri.toISOString().split('T')[0]
    ];
  };

  const getOrCreateSyncFolder = async (rootId) => {
    if (nodeMappings.syncFolderId) {
      return nodeMappings.syncFolderId;
    }
    
    const res = await callWorkflowy('list-children', { item_id: rootId });
    const children = res.items || res.children || [];
    const match = children.find(node => cleanText(node.name).includes('Shared Sync Data 🔄'));
    if (match) {
      setNodeMappings(prev => {
        const updated = { ...prev, syncFolderId: match.id };
        localStorage.setItem('wf_node_mappings', JSON.stringify(updated));
        return updated;
      });
      return match.id;
    }
    
    const newFolder = await callWorkflowy('create-item', {
      parent_id: rootId,
      name: 'Shared Sync Data 🔄',
      position: 'bottom'
    });
    const newId = newFolder.id || newFolder.item?.id;
    setNodeMappings(prev => {
      const updated = { ...prev, syncFolderId: newId };
      localStorage.setItem('wf_node_mappings', JSON.stringify(updated));
      return updated;
    });
    return newId;
  };

  const saveWeekToCloud = async (sundayDate, menu, locked) => {
    if (!apiKey || !rootNodeId) return;
    
    const allowedWeeks = getSyncWindowSundays();
    if (!allowedWeeks.includes(sundayDate)) {
      return; 
    }
    
    setCloudSyncState('saving');
    
    try {
      const syncFolderId = await getOrCreateSyncFolder(rootNodeId);
      const res = await callWorkflowy('list-children', { item_id: syncFolderId });
      const children = res.items || res.children || [];
      const bulletName = `Sync Week of ${sundayDate}`;
      
      const match = children.find(node => cleanText(node.name) === bulletName);
      const payload = JSON.stringify({
        weeklyMenu: menu,
        lockedSlots: locked,
        updatedAt: new Date().toISOString()
      });
      
      if (match) {
        await callWorkflowy('edit-item', {
          item_id: match.id,
          note: payload
        });
      } else {
        const newBullet = await callWorkflowy('create-item', {
          parent_id: syncFolderId,
          name: bulletName,
          position: 'bottom'
        });
        const newId = newBullet.id || newBullet.item?.id;
        await callWorkflowy('edit-item', {
          item_id: newId,
          note: payload
        });
      }
      setCloudSyncState('saved');
      setTimeout(() => setCloudSyncState('idle'), 2000);
    } catch (err) {
      console.error("Cloud sync save failed:", err);
      setCloudSyncState('error');
      setTimeout(() => setCloudSyncState('idle'), 4000);
    }
  };

  const loadWeekFromCloud = async (sundayDate) => {
    if (!apiKey || !rootNodeId) return;
    
    const allowedWeeks = getSyncWindowSundays();
    if (!allowedWeeks.includes(sundayDate)) {
      return; 
    }
    
    setCloudSyncState('saving');
    
    try {
      const syncFolderId = await getOrCreateSyncFolder(rootNodeId);
      const res = await callWorkflowy('list-children', { item_id: syncFolderId });
      const children = res.items || res.children || [];
      const bulletName = `Sync Week of ${sundayDate}`;
      
      const match = children.find(node => cleanText(node.name) === bulletName);
      if (match && match.note) {
        const data = JSON.parse(match.note);
        if (data && data.weeklyMenu) {
          setWeeklyMenu(prev => {
            const prevNames = Object.entries(prev).map(([k, v]) => `${k}:${v?.name}`).join(',');
            const newNames = Object.entries(data.weeklyMenu).map(([k, v]) => `${k}:${v?.name}`).join(',');
            if (prevNames === newNames) return prev;
            return { ...prev, ...data.weeklyMenu };
          });
          
          if (data.lockedSlots) {
            setLockedSlots(prev => {
              const prevLock = Object.entries(prev).map(([k, v]) => `${k}:${v}`).join(',');
              const newLock = Object.entries(data.lockedSlots).map(([k, v]) => `${k}:${v}`).join(',');
              if (prevLock === newLock) return prev;
              return { ...prev, ...data.lockedSlots };
            });
          }
        }
      }
      setCloudSyncState('saved');
      setTimeout(() => setCloudSyncState('idle'), 1500);
    } catch (err) {
      console.error("Cloud sync load failed:", err);
      setCloudSyncState('error');
      setTimeout(() => setCloudSyncState('idle'), 3000);
    }
  };

  // Cloud Sync debouncing hook
  const cloudSyncTimeoutRef = useRef(null);
  useEffect(() => {
    if (!apiKey || !rootNodeId || isLoading) return;
    
    const allowedWeeks = getSyncWindowFridays();
    if (!allowedWeeks.includes(selectedFriday)) return;
    
    if (cloudSyncTimeoutRef.current) {
      clearTimeout(cloudSyncTimeoutRef.current);
    }
    
    cloudSyncTimeoutRef.current = setTimeout(() => {
      saveWeekToCloud(selectedFriday, weeklyMenu, lockedSlots);
    }, 3000);
    
    return () => {
      if (cloudSyncTimeoutRef.current) {
        clearTimeout(cloudSyncTimeoutRef.current);
      }
    };
  }, [weeklyMenu, lockedSlots, selectedFriday, apiKey, rootNodeId]);

  // Load from cloud when week changes
  useEffect(() => {
    if (apiKey && rootNodeId) {
      loadWeekFromCloud(selectedFriday);
    }
  }, [selectedFriday, rootNodeId]);

  const syncDinnersToGoogleCalendar = async () => {
    if (!googleAccessToken) {
      alert('Please connect to Google Calendar first inside the Config tab!');
      setActiveTab('settings');
      return;
    }
    
    setIsLoading(true);
    setSyncMessage({ type: 'success', text: 'Syncing dinners to Google Calendar...' });
    
    try {
      const [hours, minutes] = dinnerTime.split(':').map(Number);
      let successCount = 0;
      
      for (const day of days) {
        const mealKey = `${day}-dinner`;
        const meal = weeklyMenu[mealKey];
        if (!meal || !meal.name || meal.name.includes('Choose')) {
          continue;
        }
        
        const d = getDayDate(day);
        const startEventDate = new Date(d);
        startEventDate.setHours(hours, minutes, 0, 0);
        
        const endEventDate = new Date(startEventDate);
        endEventDate.setHours(startEventDate.getHours() + 1);
        
        const cleanMealName = cleanText(meal.name);
        const hasWorkflowyId = meal.id && !meal.id.startsWith('seed-') && !meal.id.startsWith('rolled-') && !meal.id.startsWith('manual-');
        const wfLink = hasWorkflowyId ? `https://workflowy.com/#/${meal.id}` : '';
        
        const description = [
          `Scheduled Dinner: ${cleanMealName}`,
          wfLink ? `Workflowy Recipe Link: ${wfLink}` : '',
          `Generated by Fresh Kitchen Planner 🍴`
        ].filter(Boolean).join('\n\n');
        
        const eventBody = {
          summary: `🍲 Dinner: ${cleanMealName}`,
          description: description,
          start: {
            dateTime: startEventDate.toISOString()
          },
          end: {
            dateTime: endEventDate.toISOString()
          }
        };
        
        const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(selectedCalendarId)}/events`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${googleAccessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(eventBody)
        });
        
        if (res.ok) {
          successCount++;
        } else {
          const err = await res.json();
          console.error(`Failed to add dinner for ${day}:`, err);
        }
      }
      
      setSyncMessage({ 
        type: 'success', 
        text: `Successfully synced ${successCount} dinner events to your calendar!` 
      });
      setTimeout(() => setSyncMessage(null), 5000);
    } catch (err) {
      console.error('Error syncing to Google Calendar:', err);
      setSyncMessage({ 
        type: 'error', 
        text: `Failed to sync dinners: ${err.message}` 
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Current date formatted beautifully
  const currentWeekLabel = useMemo(() => {
    const start = new Date(selectedFriday);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    
    const formatCustomDate = (date) => {
      const daysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thur', 'Fri', 'Sat'];
      const monthsFull = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      const dayName = daysShort[date.getDay()];
      const monthName = monthsFull[date.getMonth()];
      const dateNum = date.getDate();
      return `${dayName} ${monthName} ${dateNum}`;
    };
    
    return `${formatCustomDate(start)} - ${formatCustomDate(end)}`;
  }, [selectedFriday]);

  // Days list & Slot Categories
  const days = ['Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];
  const slots = [
    { id: 'breakfast-kyle', label: 'Breakfast: Kyle', color: 'badge-yellow' },
    { id: 'breakfast-ariel', label: 'Breakfast: Ariel', color: 'badge-yellow' },
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
    const rotation = getRotationForDate(selectedFriday);

    days.forEach(day => {
      // 1. Breakfast (Kyle)
      const bKyleKey = `${day}-breakfast-kyle`;
      if (!newMenu[bKyleKey]) {
        if (day === 'Saturday') {
          newMenu[bKyleKey] = {
            id: 'manual-small-group',
            name: 'Small Group',
            source: 'default',
            category: 'breakfasts'
          };
        } else {
          newMenu[bKyleKey] = {
            id: `seed-b-kyle-${rotation.breakfast.id}`,
            name: rotation.breakfast.name,
            source: 'spreadsheet',
            category: 'breakfasts'
          };
        }
        changed = true;
      }

      // 2. Breakfast (Ariel)
      const bArielKey = `${day}-breakfast-ariel`;
      if (!newMenu[bArielKey]) {
        newMenu[bArielKey] = {
          id: `seed-b-ariel-${rotation.breakfast.id}`,
          name: rotation.breakfast.name,
          source: 'spreadsheet',
          category: 'breakfasts'
        };
        changed = true;
      }

      // 3. Lunch
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

      // 4. Snack
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

      // 5. Dinner is left unselected or rolls on demand based on Option A
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

    // Seeding & self-healing for unified Weekday slots
    ['breakfast-kyle', 'breakfast-ariel', 'lunch', 'snack'].forEach(slotId => {
      const key = `Weekday-${slotId}`;
      const isB = slotId.startsWith('breakfast');
      const rotVal = isB ? rotation.breakfast : rotation[slotId];
      const seedPrefix = isB ? 'b' : slotId === 'lunch' ? 'l' : 's';
      const catName = isB ? 'breakfasts' : `${slotId}s`;
      
      if (!newMenu[key]) {
        // First try to load from Monday's slot if it exists (for compatibility with existing drafts)
        const existingDefault = newMenu[`Monday-${slotId}`];
        if (existingDefault && existingDefault.name && !existingDefault.name.includes('Choose')) {
          newMenu[key] = { ...existingDefault };
        } else {
          newMenu[key] = {
            id: `seed-${seedPrefix}-${rotVal.id}`,
            name: rotVal.name,
            source: 'spreadsheet',
            category: catName
          };
        }
        changed = true;
      }
    });

    if (changed) {
      setWeeklyMenu(newMenu);
    }
  }, [selectedFriday]);

  // --- WORKFLOWY API CLIENT ENGINES ---
  async function callWorkflowy(action, body) {
    const token = apiKey.trim();

    return new Promise((resolve, reject) => {
      requestQueue = requestQueue
        .then(async () => {
          // Enforce 350ms spacing between any consecutive requests
          await new Promise(r => setTimeout(r, 350));
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
      });

      // Resolve customizable menu folder ID
      let foundMenuId = null;
      if (weeklyPlanFolder) {
        const cleanId = weeklyPlanFolder.trim().replace(/^.*\/#\//, '');
        const isId = /^[0-9a-fA-F-]{12,36}$/.test(cleanId);
        if (isId) {
          foundMenuId = cleanId;
        } else {
          const match = subNodes.find(node => cleanText(node.name).toLowerCase().includes(weeklyPlanFolder.toLowerCase().trim()));
          if (match) foundMenuId = match.id;
        }
      }

      if (!foundMenuId) {
        // Fallback to searching for "menu"
        const match = subNodes.find(node => cleanText(node.name).toLowerCase().includes('menu'));
        if (match) foundMenuId = match.id;
      }

      mappings.menuId = foundMenuId;

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

      setSyncMessage('Fetching existing Shopping List bullets...');
      try {
        const wfGroceriesList = await fetchWorkflowyGroceries(mappings.groceryId);
        setWorkflowyGroceries(wfGroceriesList);
      } catch (err) {
        console.warn('Failed to pre-fetch Workflowy groceries during sync', err);
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

  // Helper to fetch existing grocery items in Workflowy (collapsing dated weekly sub-folders)
  async function fetchWorkflowyGroceries(groceryId) {
    if (!groceryId) return [];
    try {
      const response = await callWorkflowy('list-children', { item_id: groceryId });
      const items = response.items || response.children || [];
      
      const results = [];
      for (const item of items) {
        if (item.is_completed) continue;
        
        const cleanName = cleanText(item.name).toLowerCase();
        // If it's a dated grocery folder, fetch the child ingredients!
        if (cleanName.includes('grocery list') || cleanName.includes('week of')) {
          try {
            const subRes = await callWorkflowy('list-children', { item_id: item.id });
            const subItems = subRes.items || subRes.children || [];
            subItems.forEach(sub => {
              if (!sub.is_completed && sub.name) {
                results.push({
                  id: sub.id,
                  name: cleanText(sub.name),
                  parentId: item.id
                });
              }
            });
          } catch (err) {
            console.warn(`Failed to list sub-grocery list children: ${item.name}`, err);
          }
        } else if (item.name) {
          // Loose ingredient directly under the main folder
          results.push({
            id: item.id,
            name: cleanText(item.name),
            parentId: groceryId
          });
        }
      }
      return results;
    } catch (e) {
      console.warn("Failed to fetch Workflowy groceries:", e);
      return [];
    }
  }

  // Toggle checkout status and synchronize in the background with Workflowy
  async function toggleGroceryCheck(groc) {
    const isChecked = !shoppingChecked[groc.name];
    setShoppingChecked(prev => ({ ...prev, [groc.name]: isChecked }));

    if (groc.id) {
      try {
        if (isChecked) {
          await callWorkflowy('complete-item', { item_id: groc.id });
        } else {
          await callWorkflowy('uncomplete-item', { item_id: groc.id });
        }
      } catch (err) {
        console.warn(`Failed to sync checkbox state to Workflowy for: ${groc.name}`, err);
      }
    }
  }

  // Fetch Workflowy groceries in the background whenever navigating to the Shopping List tab
  useEffect(() => {
    let active = true;
    if (activeTab === 'groceries' && nodeMappings.groceryId) {
      async function updateWfGroceries() {
        const list = await fetchWorkflowyGroceries(nodeMappings.groceryId);
        if (active) {
          setWorkflowyGroceries(list);
        }
      }
      updateWfGroceries();
    }
    return () => { active = false; };
  }, [activeTab, nodeMappings.groceryId]);



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

  // Combined grocery list merging planner ingredients and active Workflowy bullets
  const mergedGroceries = useMemo(() => {
    const finalMap = {};

    // 1. Process all planner-generated ingredients
    consolidatedGroceries.forEach(groc => {
      const cleanKey = groc.name.trim().toLowerCase();
      finalMap[cleanKey] = {
        name: groc.name,
        sources: groc.sources,
        id: null
      };
    });

    // 2. Merge with items currently active in Workflowy
    workflowyGroceries.forEach(wfGroc => {
      const cleanKey = wfGroc.name.trim().toLowerCase();
      if (finalMap[cleanKey]) {
        // Planner ingredient that already exists in Workflowy: map the ID!
        finalMap[cleanKey].id = wfGroc.id;
      } else {
        // Custom manual item in Workflowy: add it!
        finalMap[cleanKey] = {
          name: wfGroc.name,
          sources: 'Workflowy List 🛒',
          id: wfGroc.id
        };
      }
    });

    return Object.values(finalMap).sort((a, b) => a.name.localeCompare(b.name));
  }, [consolidatedGroceries, workflowyGroceries]);

  // --- GAMIFIED LOTTERY ENGINE ---
  function rollSlot(day, slot) {
    const key = `${day}-${slot}`;
    if (lockedSlots[key]) return; // locked

    setRollingSlots(prev => ({ ...prev, [key]: true }));

    setTimeout(() => {
      let pool = [];
      if (slot.startsWith('breakfast')) {
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

      const randomRecipe = (day === 'Saturday' && slot === 'breakfast-kyle')
        ? { id: 'manual-small-group', name: 'Small Group' }
        : pool[Math.floor(Math.random() * pool.length)];
      const mealObj = {
        id: randomRecipe.id || `rolled-${slot}-${Date.now()}`,
        name: randomRecipe.name,
        source: randomRecipe.id ? 'workflowy' : 'seed',
        category: slot === 'dinner' ? 'dinners' : (slot.startsWith('breakfast') ? 'breakfasts' : `${slot}s`)
      };

      setWeeklyMenu(prev => {
        const updated = { ...prev };
        if (day === 'Weekday') {
          ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach(d => {
            updated[`${d}-${slot}`] = mealObj;
          });
          updated[`Weekday-${slot}`] = mealObj;
        } else {
          updated[key] = mealObj;
        }
        return updated;
      });

      setRollingSlots(prev => ({ ...prev, [key]: false }));
    }, 600); // 600ms match standard roll CSS transition
  }

  // Roll all slots that are not locked
  function rollAllUnlocked() {
    setIsRollingAll(true);
    setTimeout(() => setIsRollingAll(false), 1000);

    // 1. Roll Weekday slots (Mon - Fri) unified
    if (!lockedSlots['Weekday-breakfast-kyle']) rollSlot('Weekday', 'breakfast-kyle');
    if (!lockedSlots['Weekday-breakfast-ariel']) rollSlot('Weekday', 'breakfast-ariel');
    if (!lockedSlots['Weekday-lunch']) rollSlot('Weekday', 'lunch');
    if (!lockedSlots['Weekday-snack']) rollSlot('Weekday', 'snack');

    // 2. Roll Saturday slots
    if (!lockedSlots['Saturday-breakfast-kyle']) rollSlot('Saturday', 'breakfast-kyle');
    if (!lockedSlots['Saturday-breakfast-ariel']) rollSlot('Saturday', 'breakfast-ariel');
    if (!lockedSlots['Saturday-lunch']) rollSlot('Saturday', 'lunch');
    if (!lockedSlots['Saturday-snack']) rollSlot('Saturday', 'snack');

    // 3. Roll Sunday slots
    if (!lockedSlots['Sunday-breakfast-kyle']) rollSlot('Sunday', 'breakfast-kyle');
    if (!lockedSlots['Sunday-breakfast-ariel']) rollSlot('Sunday', 'breakfast-ariel');
    if (!lockedSlots['Sunday-lunch']) rollSlot('Sunday', 'lunch');
    if (!lockedSlots['Sunday-snack']) rollSlot('Sunday', 'snack');

    // 4. Roll Dinners for all days individually
    days.forEach(d => {
      if (!lockedSlots[`${d}-dinner`]) {
        rollSlot(d, 'dinner');
      }
    });
  }

  // Toggle locked slot
  function toggleLock(day, slot) {
    const key = `${day}-${slot}`;
    setLockedSlots(prev => {
      const nextVal = !prev[key];
      const updated = { ...prev, [key]: nextVal };
      if (day === 'Weekday') {
        ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach(d => {
          updated[`${d}-${slot}`] = nextVal;
        });
      }
      return updated;
    });
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
    if (slot.startsWith('breakfast')) {
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
    
    setWeeklyMenu(prev => {
      const updated = { ...prev };
      const mealObj = {
        id: item.id || `manual-${slot}-${Date.now()}`,
        name: item.name,
        source: item.id ? 'workflowy' : 'seed',
        category: slot === 'dinner' ? 'dinners' : (slot.startsWith('breakfast') ? 'breakfasts' : `${slot}s`)
      };

      if (day === 'Weekday') {
        ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach(d => {
          updated[`${d}-${slot}`] = mealObj;
        });
        updated[`Weekday-${slot}`] = mealObj;
      } else {
        const key = `${day}-${slot}`;
        updated[key] = mealObj;
      }
      return updated;
    });

    setLockedSlots(prev => {
      const key = `${day}-${slot}`;
      return { ...prev, [key]: true };
    });

    setShowSearchModal(null);
  }

  // --- WRITEBACK TO WORKFLOWY ---
  async function writeBackToWorkflowy() {
    // Resolve dynamically from weeklyPlanFolder if provided
    let targetMenuId = null;
    if (weeklyPlanFolder && rootNodeId) {
      const cleanPlanId = weeklyPlanFolder.trim().replace(/^.*\/#\//, '');
      const isId = /^[0-9a-fA-F-]{12,36}$/.test(cleanPlanId);
      if (isId) {
        targetMenuId = cleanPlanId;
      } else {
        // Resolve by name under the root meal planning folder
        try {
          const res = await callWorkflowy('list-children', { item_id: rootNodeId });
          const children = res.items || res.children || [];
          const match = children.find(node => cleanText(node.name).toLowerCase().includes(weeklyPlanFolder.toLowerCase().trim()));
          if (match) {
            targetMenuId = match.id;
          }
        } catch (e) {
          console.error("Failed to dynamically resolve weeklyPlanFolder:", e);
        }
      }
    }
    
    if (!targetMenuId) {
      targetMenuId = nodeMappings.menuId;
    }

    if (!targetMenuId && rootNodeId) {
      // Fallback search
      try {
        const res = await callWorkflowy('list-children', { item_id: rootNodeId });
        const children = res.items || res.children || [];
        const match = children.find(node => cleanText(node.name).toLowerCase().includes('menu'));
        if (match) {
          targetMenuId = match.id;
        }
      } catch (e) {
        console.error("Failed fallback menu search:", e);
      }
    }

    if (!rootNodeId || !targetMenuId || !nodeMappings.groceryId) {
      alert('You must sync with your Workflowy account first to map the outlines!');
      return;
    }

    setIsLoading(true);
    setSyncMessage('Generating Weekly Plan outline in Workflowy...');

    try {
      const weekLabel = `Week of ${selectedFriday}`;

      // 1. Check if the week already exists in Menu for the Week, and delete it if so to avoid duplicates
      const menuChildrenRes = await callWorkflowy('list-children', { item_id: targetMenuId });
      const currentMenus = menuChildrenRes.items || menuChildrenRes.children || [];
      const oldWeekNode = currentMenus.find(m => cleanText(m.name).includes(weekLabel));
      if (oldWeekNode) {
        setSyncMessage('Updating existing week outline...');
        await callWorkflowy('delete-item', { item_id: oldWeekNode.id });
      }

      // 2. Create the main Week bullet in Menu for the Week
      const weekNodeRes = await callWorkflowy('create-item', {
        parent_id: targetMenuId,
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
          const emoji = slot.id.startsWith('breakfast') ? '🥞' : slot.id === 'lunch' ? '🥗' : slot.id === 'snack' ? '🥨' : '🍲';
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

  const getDayDate = (dayName) => {
    const start = new Date(selectedFriday);
    let offset = 0;
    if (dayName === 'Friday') offset = 0;
    else if (dayName === 'Saturday') offset = 1;
    else if (dayName === 'Sunday') offset = 2;
    else if (dayName === 'Monday') offset = 3;
    else if (dayName === 'Tuesday') offset = 4;
    else if (dayName === 'Wednesday') offset = 5;
    else if (dayName === 'Thursday') offset = 6;
    
    start.setDate(start.getDate() + offset);
    return start;
  };

  const formatDateLabel = (dayName, formatType) => {
    const d = getDayDate(dayName);
    const month = d.toLocaleDateString('en-US', { month: 'long' }); // e.g. "May"
    const monthShort = d.toLocaleDateString('en-US', { month: 'short' }); // e.g. "May"
    const dateNum = d.getDate();
    
    if (formatType === 'weekend') {
      return `${dayName}, ${month} ${dateNum}`; // Saturday, May 30
    } else if (formatType === 'dinner') {
      return `${dayName} (${monthShort} ${dateNum}) Dinner`; // Monday (May 25) Dinner
    }
    return dayName;
  };

  const renderPlannerSlot = (day, slotId, customLabel = null) => {
    const key = `${day}-${slotId}`;
    const recipe = weeklyMenu[key] || { name: 'Choose...' };
    const isLocked = lockedSlots[key];
    const isRolling = rollingSlots[key];
    
    const slotDef = slots.find(s => s.id === slotId) || { label: slotId, color: 'badge-green' };
    const label = customLabel || slotDef.label;

    return (
      <div key={slotId} className={`slot-container ${isLocked ? 'locked' : ''}`}>
        <div className="slot-info" onClick={() => openSelector(day, slotId)}>
          <div className="slot-label">{label}</div>
          <div className={`slot-value ${isRolling ? 'rolling' : ''}`}>
            {cleanText(recipe.name)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {/* Lock Toggle */}
          <button 
            onClick={() => toggleLock(day, slotId)} 
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
            onClick={() => rollSlot(day, slotId)} 
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
  };

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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {cloudSyncState === 'saving' && (
              <span className="badge badge-yellow" style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'none' }}>
                <RefreshCw size={10} className="spin-icon" /> Syncing...
              </span>
            )}
            {cloudSyncState === 'saved' && (
              <span className="badge badge-green" style={{ fontSize: '0.7rem', textTransform: 'none' }}>
                Cloud Saved ☁️
              </span>
            )}
            {cloudSyncState === 'error' && (
              <span className="badge" style={{ fontSize: '0.7rem', background: '#fee2e2', color: '#991b1b', textTransform: 'none' }}>
                Sync Error ⚠️
              </span>
            )}
            {cloudSyncState === 'idle' && rootNodeId && (
              <span className="badge badge-green" style={{ fontSize: '0.7rem', opacity: 0.6, background: '#f3f4f6', color: '#4b5563', textTransform: 'none' }}>
                Cloud Active ☁️
              </span>
            )}
            
            <button 
              onClick={syncFromWorkflowy} 
              className="btn btn-outline" 
              style={{ minHeight: '36px', height: '36px', padding: '0 12px', width: 'auto', fontSize: '0.85rem' }}
              disabled={isLoading}
            >
              <RefreshCw size={14} className={isLoading ? 'spin-icon' : ''} />
              Sync
            </button>
          </div>
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

          <div className="input-group" style={{ textAlign: 'left', marginBottom: '20px' }}>
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

          <div className="input-group" style={{ textAlign: 'left', marginBottom: '24px' }}>
            <label className="input-label">where in Workflowy to save the Weekly Plan (Optional)</label>
            <input
              type="text"
              placeholder="e.g. Menu for the Week OR bullet ID / link"
              className="input-text"
              value={weeklyPlanFolder}
              onChange={(e) => setWeeklyPlanFolder(e.target.value)}
            />
            <p style={{ fontSize: '0.75rem', marginTop: '4px', color: 'var(--text-muted)' }}>
              Specify a custom bullet name or paste a bullet link/ID where the weekly plan should be saved. Defaults to searching for a child bullet containing "menu".
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
            style={{ flex: '1 1 auto', minHeight: '40px', padding: '8px 12px', fontSize: '0.9rem', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            onClick={() => setActiveTab('planner')}
          >
            <Calendar size={16} /> Planner
          </button>
          <button 
            className={`btn ${activeTab === 'groceries' ? 'btn-primary' : 'btn-outline'}`} 
            style={{ flex: '1 1 auto', minHeight: '40px', padding: '8px 12px', fontSize: '0.9rem', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            onClick={() => setActiveTab('groceries')}
          >
            <ShoppingCart size={16} /> Shopping ({mergedGroceries.length})
          </button>
          <button 
            className={`btn ${activeTab === 'share' ? 'btn-primary' : 'btn-outline'}`} 
            style={{ flex: '0 0 44px', width: '44px', minHeight: '40px', padding: '8px', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setActiveTab('share')}
            title="Share Menu"
          >
            <MessageSquare size={18} />
          </button>
          <button 
            className={`btn ${activeTab === 'settings' ? 'btn-primary' : 'btn-outline'}`} 
            style={{ flex: '0 0 44px', width: '44px', minHeight: '40px', padding: '8px', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setActiveTab('settings')}
            title="Settings / Config"
          >
            <Settings size={18} />
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
                const prev = new Date(selectedFriday);
                prev.setDate(prev.getDate() - 7);
                setSelectedFriday(prev.toISOString().split('T')[0]);
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
                const next = new Date(selectedFriday);
                next.setDate(next.getDate() + 7);
                setSelectedFriday(next.toISOString().split('T')[0]);
              }}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Quick Roll Button */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-secondary" onClick={rollAllUnlocked} style={{ flex: 1 }}>
              <RefreshCw size={18} className={isRollingAll ? 'roll-all-spin' : ''} />
              Roll All Unlocked
            </button>
          </div>

          {/* Weekday Routine Card */}
          <div className="card card-primary" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
              <h3 style={{ color: 'var(--primary-dark)', fontWeight: 800 }}>Weekday Routine 🍱</h3>
              <span className="badge badge-green" style={{ fontSize: '0.7rem' }}>Mon – Fri Same Plan</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {renderPlannerSlot('Weekday', 'breakfast-kyle')}
              {renderPlannerSlot('Weekday', 'breakfast-ariel')}
              {renderPlannerSlot('Weekday', 'lunch')}
              {renderPlannerSlot('Weekday', 'snack')}
            </div>
          </div>

          {/* Weekly Dinners Card */}
          <div className="card card-primary" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
              <h3 style={{ color: 'var(--primary-dark)', fontWeight: 800 }}>Weekly Dinners 🍲</h3>
              <span className="badge badge-yellow" style={{ fontSize: '0.7rem' }}>Daily Selection</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {days.map(day => renderPlannerSlot(day, 'dinner', formatDateLabel(day, 'dinner')))}
            </div>
          </div>

          {/* Weekend Routine Card */}
          <div className="card card-primary" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
              <h3 style={{ color: 'var(--primary-dark)', fontWeight: 800 }}>Weekend Routine 🥐</h3>
              <span className="badge badge-green" style={{ fontSize: '0.7rem' }}>Sat – Sun Plan</span>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Saturday Section */}
              <div>
                <h4 style={{ color: 'var(--primary)', fontWeight: 700, fontSize: '0.95rem', marginBottom: '8px', borderBottom: '1px dashed var(--border)', paddingBottom: '4px' }}>
                  {formatDateLabel('Saturday', 'weekend')}
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {renderPlannerSlot('Saturday', 'breakfast-kyle')}
                  {renderPlannerSlot('Saturday', 'breakfast-ariel')}
                  {renderPlannerSlot('Saturday', 'lunch')}
                  {renderPlannerSlot('Saturday', 'snack')}
                  {renderPlannerSlot('Saturday', 'dinner', 'Saturday Dinner')}
                </div>
              </div>

              {/* Sunday Section */}
              <div>
                <h4 style={{ color: 'var(--primary)', fontWeight: 700, fontSize: '0.95rem', marginBottom: '8px', borderBottom: '1px dashed var(--border)', paddingBottom: '4px' }}>
                  {formatDateLabel('Sunday', 'weekend')}
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {renderPlannerSlot('Sunday', 'breakfast-kyle')}
                  {renderPlannerSlot('Sunday', 'breakfast-ariel')}
                  {renderPlannerSlot('Sunday', 'lunch')}
                  {renderPlannerSlot('Sunday', 'snack')}
                  {renderPlannerSlot('Sunday', 'dinner', 'Sunday Dinner')}
                </div>
              </div>
            </div>
          </div>

          {/* Sticky Bottom Share bar */}
          <div className="bottom-tray">
            <button className="btn btn-primary" onClick={() => setActiveTab('share')}>
              <Share2 size={20} />
              Share Meal Plan 📤
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
                  const txt = mergedGroceries.map(g => `• ${g.name} (${g.sources})`).join('\n');
                  copyToClipboard(txt, 'Grocery list copied for texting!');
                }}
              >
                <Copy size={16} /> Copy List
              </button>
            </div>

            {mergedGroceries.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '24px 0' }}>No meals planned yet. Go schedule some in the planner tab!</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {mergedGroceries.map(groc => {
                  const isChecked = shoppingChecked[groc.name];
                  return (
                    <div 
                      key={groc.name} 
                      onClick={() => toggleGroceryCheck(groc)}
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

          {/* Calendar Sync & Export Card */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 16px' }}>
            <div style={{ fontWeight: 800, color: 'var(--primary-dark)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>📅 Add Dinners to Calendar</span>
            </div>
            
            <div style={{ 
              display: 'flex', 
              gap: '10px', 
              flexWrap: 'wrap'
            }}>
              {googleClientId && (
                <button 
                  className="btn btn-outline" 
                  style={{ 
                    flex: 1, 
                    minWidth: '160px',
                    minHeight: '38px', 
                    fontSize: '0.85rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    gap: '8px',
                    background: googleAccessToken ? '#ecfdf5' : 'white',
                    borderColor: googleAccessToken ? '#10b981' : 'var(--border)',
                    color: googleAccessToken ? '#047857' : 'var(--text-main)'
                  }}
                  onClick={googleAccessToken ? syncDinnersToGoogleCalendar : handleAuthorize}
                >
                  <Calendar size={16} /> 
                  {googleAccessToken ? 'Sync to Google 📅' : 'Connect Google 📅'}
                </button>
              )}
              <button 
                className="btn btn-outline" 
                style={{ 
                  flex: 1, 
                  minWidth: '160px',
                  minHeight: '38px', 
                  fontSize: '0.85rem', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  gap: '8px' 
                }}
                onClick={exportWeekToICS}
              >
                <Share2 size={16} /> 
                Export to ICS 📤
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
            gap: '14px'
          }}>
            <div style={{ textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: '14px' }}>
              <h2 style={{ fontSize: '1.6rem', color: '#fbbf24', fontWeight: 800 }}>🌿 Fresh Kitchen Menu 🍋</h2>
              <span style={{ fontSize: '0.8rem', opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                {currentWeekLabel}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Section 1: Weekday Routine */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                padding: '12px 16px',
                borderRadius: 'var(--radius-lg)'
              }}>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fef3c7', marginBottom: '6px', borderBottom: '1px dashed rgba(255,255,255,0.15)', paddingBottom: '2px', marginTop: 0 }}>
                  Weekday Routine (Mon – Fri) 🍱
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.9rem' }}>
                  <div>🥐 <strong style={{ color: '#fef3c7' }}>Kyle's Breakfast:</strong> {cleanText(weeklyMenu['Monday-breakfast-kyle']?.name) || '---'}</div>
                  <div>🥐 <strong style={{ color: '#fef3c7' }}>Ariel's Breakfast:</strong> {cleanText(weeklyMenu['Monday-breakfast-ariel']?.name) || '---'}</div>
                  <div>🥗 <strong style={{ color: '#fef3c7' }}>Lunch:</strong> {cleanText(weeklyMenu['Monday-lunch']?.name) || '---'}</div>
                  <div>🍿 <strong style={{ color: '#fef3c7' }}>Snack:</strong> {cleanText(weeklyMenu['Monday-snack']?.name) || '---'}</div>
                </div>
              </div>

              {/* Section 2: Dinners */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                padding: '12px 16px',
                borderRadius: 'var(--radius-lg)'
              }}>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fbbf24', marginBottom: '6px', borderBottom: '1px dashed rgba(255,255,255,0.15)', paddingBottom: '2px', marginTop: 0 }}>
                  Dinners for the Week 🍲
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.9rem' }}>
                  {days.map(day => {
                    const dinnerName = cleanText(weeklyMenu[`${day}-dinner`]?.name);
                    const formattedLabel = formatDateLabel(day, 'dinner').replace(' Dinner', '');
                    return dinnerName && !dinnerName.includes('Choose') ? (
                      <div key={day}>🗓️ <strong style={{ color: '#fbbf24' }}>{formattedLabel}:</strong> {dinnerName}</div>
                    ) : null;
                  })}
                </div>
              </div>

              {/* Section 3: Weekend Routine & Dinners */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                padding: '12px 16px',
                borderRadius: 'var(--radius-lg)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fef3c7', borderBottom: '1px dashed rgba(255,255,255,0.15)', paddingBottom: '2px', margin: 0 }}>
                  Weekend Routine & Dinners 🥐
                </h3>
                
                {/* Saturday */}
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#fbbf24', marginBottom: '3px' }}>
                    {formatDateLabel('Saturday', 'weekend')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.85rem', paddingLeft: '8px', borderLeft: '2px solid rgba(255,255,255,0.15)' }}>
                    <div>🥐 <span style={{ opacity: 0.9 }}>Kyle B-fast:</span> {cleanText(weeklyMenu['Saturday-breakfast-kyle']?.name) || '---'}</div>
                    <div>🥐 <span style={{ opacity: 0.9 }}>Ariel B-fast:</span> {cleanText(weeklyMenu['Saturday-breakfast-ariel']?.name) || '---'}</div>
                    <div>🥗 <span style={{ opacity: 0.9 }}>Lunch:</span> {cleanText(weeklyMenu['Saturday-lunch']?.name) || '---'}</div>
                    <div>🍿 <span style={{ opacity: 0.9 }}>Snack:</span> {cleanText(weeklyMenu['Saturday-snack']?.name) || '---'}</div>
                    <div>🍲 <strong style={{ color: '#fbbf24' }}>Dinner:</strong> {cleanText(weeklyMenu['Saturday-dinner']?.name) || '---'}</div>
                  </div>
                </div>

                {/* Sunday */}
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#fbbf24', marginBottom: '3px' }}>
                    {formatDateLabel('Sunday', 'weekend')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.85rem', paddingLeft: '8px', borderLeft: '2px solid rgba(255,255,255,0.15)' }}>
                    <div>🥐 <span style={{ opacity: 0.9 }}>Kyle B-fast:</span> {cleanText(weeklyMenu['Sunday-breakfast-kyle']?.name) || '---'}</div>
                    <div>🥐 <span style={{ opacity: 0.9 }}>Ariel B-fast:</span> {cleanText(weeklyMenu['Sunday-breakfast-ariel']?.name) || '---'}</div>
                    <div>🥗 <span style={{ opacity: 0.9 }}>Lunch:</span> {cleanText(weeklyMenu['Sunday-lunch']?.name) || '---'}</div>
                    <div>🍿 <span style={{ opacity: 0.9 }}>Snack:</span> {cleanText(weeklyMenu['Sunday-snack']?.name) || '---'}</div>
                    <div>🍲 <strong style={{ color: '#fbbf24' }}>Dinner:</strong> {cleanText(weeklyMenu['Sunday-dinner']?.name) || '---'}</div>
                  </div>
                </div>
              </div>
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
              <label className="input-label">where in Workflowy to save the Weekly Plan (Optional)</label>
              <input 
                type="text" 
                className="input-text" 
                value={weeklyPlanFolder} 
                onChange={(e) => setWeeklyPlanFolder(e.target.value)} 
                placeholder="e.g. Menu for the Week OR bullet ID / link"
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Specify a custom bullet name or paste a bullet link/ID where the weekly plan should be saved. Defaults to searching for a child bullet containing "menu".
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

          {/* Card: Calendar Integration */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
              <h2 style={{ color: 'var(--primary-dark)', margin: 0 }}>Calendar Integration 📅</h2>
              <span className="badge badge-green" style={{ fontSize: '0.75rem' }}>Google & ICS Sync</span>
            </div>

            {/* Client ID Input */}
            <div className="input-group">
              <label className="input-label">Google OAuth Client ID</label>
              <input 
                type="text" 
                className="input-text" 
                value={googleClientId} 
                onChange={(e) => setGoogleClientId(e.target.value)} 
                placeholder="e.g. 123456789-abcdef.apps.googleusercontent.com"
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Create a Client ID inside your Google Cloud Console. Make sure to whitelist your local and production URLs in Authorized JavaScript Origins!
              </p>
            </div>

            {/* Dinner Event Time */}
            <div className="input-group">
              <label className="input-label">Configured Dinner Time</label>
              <input 
                type="time" 
                className="input-text" 
                value={dinnerTime} 
                onChange={(e) => setDinnerTime(e.target.value)} 
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Dinners will be scheduled at this time on their respective calendar dates (1 hour duration).
              </p>
            </div>

            {/* Auth Connection Status & Controls */}
            <div style={{ padding: '14px', background: '#fafaf9', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontWeight: 700, color: 'var(--primary-dark)', fontSize: '0.9rem' }}>
                Status: {googleAccessToken ? <span style={{ color: '#047857' }}>Connected 🟢</span> : <span style={{ color: 'var(--text-muted)' }}>Disconnected 🔴</span>}
              </div>

              {googleAccessToken && (
                <>
                  <div className="input-group" style={{ margin: 0 }}>
                    <label className="input-label">Select Calendar Target</label>
                    <select 
                      className="input-text"
                      value={selectedCalendarId}
                      onChange={(e) => setSelectedCalendarId(e.target.value)}
                      style={{ padding: '8px 12px', background: 'white' }}
                    >
                      {googleCalendars.length === 0 ? (
                        <option value={selectedCalendarId}>Loading calendars...</option>
                      ) : (
                        googleCalendars.map(cal => (
                          <option key={cal.id} value={cal.id}>
                            {cal.summary} {cal.primary ? '(Primary)' : ''}
                          </option>
                        ))
                      )}
                    </select>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Choose your secondary calendar (e.g. <b>"Family"</b>) to avoid cluttering your personal agenda!
                    </p>
                  </div>

                  <button 
                    className="btn btn-outline" 
                    onClick={() => {
                      setGoogleAccessToken('');
                      setGoogleCalendars([]);
                    }}
                    style={{ width: '100%' }}
                  >
                    Disconnect Google Calendar
                  </button>
                </>
              )}

              {!googleAccessToken && (
                <button 
                  className="btn btn-primary" 
                  onClick={handleAuthorize}
                  style={{ width: '100%' }}
                >
                  Connect & Authenticate with Google
                </button>
              )}
            </div>

            {/* Clear and Simple Instructions */}
            <div style={{ padding: '14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', color: '#166534', lineHeight: '1.4' }}>
              <div style={{ fontWeight: 700, marginBottom: '6px', color: '#14532d' }}>How to get a Google Client ID in 2 minutes:</div>
              <ol style={{ paddingLeft: '16px', margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <li>Open the <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" style={{ fontWeight: 700, textDecoration: 'underline', color: '#15803d' }}>Google Cloud Credentials page ➔</a></li>
                <li>Create or select a project, then go to <b>Credentials</b>.</li>
                <li>Click <b>Create Credentials</b> → <b>OAuth client ID</b>. Choose Application type: <b>Web application</b>.</li>
                <li>Under <b>Authorized JavaScript Origins</b>, add these URIs:
                  <ul style={{ paddingLeft: '14px', listStyleType: 'disc', display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '2px' }}>
                    <li><code>http://localhost:5173</code> (for development)</li>
                    <li><code>https://kylejonestn.github.io</code> (for GitHub Pages)</li>
                  </ul>
                </li>
                <li>Click Save, copy the <b>Client ID</b>, and paste it into the field above!</li>
              </ol>
            </div>
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
        v1.5.3 • Built on May 30, 2026 at 3:08 PM CT
      </footer>
    </div>
  );
}
