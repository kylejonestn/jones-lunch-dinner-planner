# 🌿 Fresh Kitchen Planner 🍋

A premium, high-fidelity mobile-first planner that syncs your weekly menu and consolidated shopping checklist directly with your **Workflowy** account using their new beta REST API. 

Designed with an organic **"HelloFresh"** (mint greens and sunshine yellows) theme, the app seeds your exact Excel-based rotation schedules, lets you dynamically roll randomized meals with satisfying **slot-machine CSS spinner animations**, locks schedule slots, and formats groceries as **collapsible outline bullets** directly in Workflowy!

---

## ✨ Features

- **📊 Excel-Aligned Weekly Rotations:** Seeds your exact sequential rotation schedule for Breakfast, Lunch, and Snack as the default baseline.
- **🎰 Gamified Slot-Machine Reel:** Click "Roll" to spin individual slots with a vertical slot-machine reel translation, landing on a random recipe fetched from your Workflowy list.
- **🔒 Planner Locks:** Lock down specific slots you love, allowing you to "Roll All Unlocked" for the remaining days.
- **📂 Workflowy Automation Crawler:** Crawls your account from the root (`"None"`) to auto-detect your `Meal Planning🍴` parent outline and sub-folders without any manual ID mapping.
- **🍲 Option A Dinner Logic:** Automatically rolls dinners from your active `Let's Eat This Soon 👍` list, falling back to `It's Been a While 🕔` or `New / Never Made ✨` if exhausted. Excludes recently eaten items.
- **🛒 Collapsible Grocery Outlines:** Deduplicates and aggregates ingredients. When writing back to Workflowy, it writes parent ingredient bullets with the exact source recipes nested as child bullets (e.g. `Apples ➔ Apple Pie, Apple Fritters`) for collapsible store walkthroughs!
- **📸 Text & Screenshot Sharing:** Optimized high-contrast menu cards ready for mobile screenshots, paired with single-click formatted texts loaded with food emojis.

---

## 🛠 Tech Stack & Architecture

```mermaid
graph TD
    subgraph Browser (Mobile Screen)
        Vite[Vite React Frontend]
        LocalStorage[LocalStorage <br> Key & State Cache]
    end

    subgraph Local Loopback (localhost)
        Express[Node.js Express CORS Proxy]
    end

    subgraph Cloud Outline
        Workflowy[Workflowy Beta servers]
    end

    Vite -->|Local Proxy requests| Express
    Express -->|Proxied POST Requests <br> Bearer Auth Token| Workflowy
```

- **Frontend:** React + Vite + Vanilla custom CSS variables + Lucide Icons. Notch-aware mobile-fit layout.
- **Backend:** Node.js Express acting as a secure local loopback proxy to bypass browser cross-origin (CORS) constraints.

---

## 🚀 Setup & Launch Instructions

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed on your machine.

### Installation
Clone or navigate to the directory and install all dependencies:
```bash
# Install root backend dependencies
npm install

# Install frontend dependencies
npm run install:frontend --prefix frontend
```

### Running Locally
To launch both the secure proxy server and compile the assets in production-mode:
```bash
npm start
```
Open **`http://localhost:3001`** in your browser.

*💡 Tip: Open this URL on your phone's browser over your local home Wi-Fi (using your computer's local IP address, e.g., `http://192.168.1.XX:3001`) to use it on the go!*

---

## 📇 Workflowy Outlining Structure
To ensure the crawler auto-detects your items, structure your Workflowy account with a primary bullet named **`Meal Planning🍴`** containing these three child bullets:

```text
- Meal Planning🍴
  - Menu for the Week
  - Shopping List 🛒 Grocery
  - Recipes 📇
    - Breakfasts
    - Lunches
    - Snacks
    - Dinners
      - Let's Eat This Soon 👍
      - It's Been a While 🕔
      - New / Never Made ✨
      - Recently Made 🍽
```
*Ingredients inside recipes should be placed inside a bullet named `Ingredients` directly under the recipe name bullet.*
