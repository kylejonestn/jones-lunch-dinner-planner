/**
 * Seed data and mathematical rotation formulas parsed from the
 * "Breakfast, Lunch, and Snack Rotations.xlsx" spreadsheet.
 */

export const SEED_BREAKFASTS = [
  { id: 1, name: "Smoothie" },
  { id: 2, name: "Waffles / Spinach Eggs" },
  { id: 3, name: "Shakshuka and potatoes" },
  { id: 4, name: "Hash" },
  { id: 5, name: "Breakfast Tacos" },
  { id: 6, name: "Avocado Toast" },
  { id: 7, name: "Açaí Bowl" },
  { id: 8, name: "Oatmeal" },
  { id: 9, name: "Breakfast Sandwich" },
  { id: 10, name: "Bagel breakfast" },
  { id: 11, name: "Muffins" },
  { id: 12, name: "eggs, toast, bacon" },
  { id: 13, name: "pancake meal prep" }
];

export const SEED_SNACKS = [
  { id: 1, name: "Granola Bar and Grapes/Fruit" },
  { id: 2, name: "Carnation and Healthy muffin" },
  { id: 3, name: "Ricotta toast" },
  { id: 4, name: "Hummus & Veggie with Naan" },
  { id: 5, name: "Trail mix or almond butter toast" },
  { id: 6, name: "Cheese, Apple, and Bread" },
  { id: 7, name: "Jerky & Fruit" },
  { id: 8, name: "Yogurt & Granola" },
  { id: 9, name: "pinwheel" },
  { id: 10, name: "Almond butter toast with apple" },
  { id: 11, name: "Healthy cookie- protein" },
  { id: 12, name: "Almond bento box" },
  { id: 13, name: "Caprese snack" },
  { id: 14, name: "Smoothie" }
];

export const SEED_LUNCHES = [
  { id: 1, name: "Bento Box" },
  { id: 2, name: "Curry" },
  { id: 3, name: "Soup / Quinoa" },
  { id: 4, name: "Salad" },
  { id: 5, name: "Italian Bento" },
  { id: 6, name: "Quesadilla Bento" },
  { id: 7, name: "Sandwich" },
  { id: 8, name: "Asian Lunch" },
  { id: 9, name: "Jamaican Jerk Meal prep" },
  { id: 10, name: "Black Bean or Turkey Burgers" },
  { id: 11, name: "Flatwrap" },
  { id: 12, name: "Pho" },
  { id: 13, name: "Burrito Bowl/ tacos" },
  { id: 14, name: "balsamic chicken and veggies" },
  { id: 15, name: "Greek Falafal" }
];

/**
 * Robust week counter since the reference date: March 1, 2026 (Sunday)
 * Uses UTC midnights to remain immune to daylight savings and timezone issues.
 */
export function getWeeksSinceBase(targetDate) {
  const base = new Date('2026-03-01T00:00:00');
  const target = new Date(targetDate);
  
  const baseUTC = Date.UTC(base.getFullYear(), base.getMonth(), base.getDate());
  const targetUTC = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeks = Math.floor((targetUTC - baseUTC) / msPerWeek);
  
  return weeks >= 0 ? weeks : 0;
}

/**
 * Calculates the Breakfast ID for a given week offset from March 1, 2026.
 * Incorporates the historical sequence values (6, 5, 4) followed by incrementing from 7.
 */
export function getBreakfastForWeek(w) {
  let id;
  if (w === 0) id = 6; // Avocado Toast
  else if (w === 1) id = 5; // Breakfast Tacos
  else if (w === 2) id = 4; // Hash
  else {
    // Week 3 restarts normal sequence at 7, then goes 8, 9... wrapping at 13
    id = ((w - 3 + 6) % 13) + 1;
  }
  return SEED_BREAKFASTS.find(b => b.id === id) || SEED_BREAKFASTS[0];
}

/**
 * Calculates the Snack ID for a given week offset.
 * Sequential progression: starting at 8, wrapping from 14 to 1.
 */
export function getSnackForWeek(w) {
  const id = ((w + 7) % 14) + 1;
  return SEED_SNACKS.find(s => s.id === id) || SEED_SNACKS[0];
}

/**
 * Calculates the Lunch ID for a given week offset.
 * Progresses sequentially but skips ID 6 (which was eaten in Week 0).
 */
export function getLunchForWeek(w) {
  const seq = [6, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const id = seq[w % 15];
  return SEED_LUNCHES.find(l => l.id === id) || SEED_LUNCHES[0];
}

/**
 * Gets the full suggested spreadsheet rotation for a specific Sunday (start of week).
 */
export function getRotationForDate(date) {
  const w = getWeeksSinceBase(date);
  return {
    breakfast: getBreakfastForWeek(w),
    snack: getSnackForWeek(w),
    lunch: getLunchForWeek(w)
  };
}
