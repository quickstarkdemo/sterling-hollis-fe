const DEFAULT_LIMIT = 12;
const FILTERED_FETCH_LIMIT = 60;

const GENDER_ALIASES = {
  men: ["men", "mens", "male", "man", "gentlemen", "gentlemens"],
  women: ["women", "womens", "female", "woman", "ladies", "lady"],
  kids: ["kids", "kid", "child", "children", "boys", "girls"],
};

const CATEGORY_ALIASES = [
  {
    category: "shoes",
    fallbackQuery: "shoes",
    tokens: ["shoes", "shoe", "footwear", "sneaker", "sneakers", "loafer", "loafers", "boot", "boots", "sandal", "sandals", "pump", "pumps", "heel", "heels"],
  },
  {
    category: "handbags",
    fallbackQuery: "handbags",
    tokens: ["handbags", "handbag", "bags", "bag", "purse", "purses", "tote", "totes", "clutch", "clutches"],
  },
  {
    category: "jewelry_accessories",
    fallbackQuery: "jewelry_accessories",
    tokens: ["jewelry", "jewellery", "accessories", "accessory", "watch", "watches", "necklace", "necklaces", "bracelet", "bracelets", "earrings", "sunglasses"],
  },
  {
    category: "beauty",
    fallbackQuery: "beauty",
    tokens: ["beauty", "makeup", "skincare", "fragrance", "perfume", "cosmetics"],
  },
  {
    category: "home",
    fallbackQuery: "home",
    tokens: ["home", "decor", "furniture", "tableware", "bedding"],
  },
  {
    category: "kids",
    fallbackQuery: "kids",
    tokens: ["kids", "kid", "children", "child", "boys", "girls"],
  },
];

const APPAREL_TOKENS = ["apparel", "clothing", "clothes", "fashion", "shirt", "shirts", "top", "tops", "trouser", "trousers", "pants", "jacket", "jackets", "coat", "coats", "dress", "dresses"];
const CATEGORY_IDS = ["beauty", "handbags", "home", "jewelry_accessories", "kids", "mens_apparel", "shoes", "womens_apparel"];

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .match(/[a-z0-9_]+/g) || [];
}

function hasAnyToken(tokens, candidates) {
  return candidates.some((candidate) => tokens.includes(candidate));
}

function detectGender(tokens) {
  if (hasAnyToken(tokens, GENDER_ALIASES.women)) return "women";
  if (hasAnyToken(tokens, GENDER_ALIASES.men)) return "men";
  if (hasAnyToken(tokens, GENDER_ALIASES.kids)) return "kids";
  return null;
}

function detectCategory(tokens, gender) {
  const explicitCategory = CATEGORY_IDS.find((category) => tokens.includes(category));
  if (explicitCategory) return explicitCategory;

  const categoryMatch = CATEGORY_ALIASES.find((rule) => hasAnyToken(tokens, rule.tokens));
  if (categoryMatch) return categoryMatch.category;

  if (hasAnyToken(tokens, APPAREL_TOKENS)) {
    if (gender === "men") return "mens_apparel";
    if (gender === "women") return "womens_apparel";
  }

  if (tokens.length === 1) {
    if (gender === "men") return "mens_apparel";
    if (gender === "women") return "womens_apparel";
  }

  return null;
}

function categoryRule(category) {
  if (category === "mens_apparel") {
    return { fallbackQuery: "mens_apparel", tokens: APPAREL_TOKENS };
  }
  if (category === "womens_apparel") {
    return { fallbackQuery: "womens_apparel", tokens: APPAREL_TOKENS };
  }
  return CATEGORY_ALIASES.find((rule) => rule.category === category);
}

function refinedQuery(tokens, gender, category, originalQuery) {
  const rule = categoryRule(category);
  const genderTokens = gender ? GENDER_ALIASES[gender] : [];
  const categoryTokens = rule?.tokens || [];
  const stopTokens = new Set([...genderTokens, ...categoryTokens, "designer"]);
  const remaining = tokens.filter((token) => !stopTokens.has(token) && !CATEGORY_IDS.includes(token));

  if (remaining.length) return remaining.join(" ");
  return rule?.fallbackQuery || originalQuery.trim();
}

export function planProductSearch(query, { limit = DEFAULT_LIMIT } = {}) {
  const cleanQuery = String(query || "").trim();
  const tokens = tokenize(cleanQuery);
  const gender = detectGender(tokens);
  const category = detectCategory(tokens, gender);
  const plannedQuery = refinedQuery(tokens, gender, category, cleanQuery);
  const needsClientFilter = Boolean(gender);

  return {
    query: plannedQuery,
    displayQuery: cleanQuery,
    gender,
    category,
    limit: needsClientFilter ? FILTERED_FETCH_LIMIT : limit,
    displayLimit: limit,
    needsClientFilter,
  };
}

export function filterPlannedSearchResults(items = [], plan) {
  const filtered = plan?.gender
    ? items.filter((item) => {
        const itemGender = String(item?.attributes?.gender || "").toLowerCase();
        return !itemGender || itemGender === plan.gender || itemGender === "unisex";
      })
    : items;

  return filtered.slice(0, plan?.displayLimit || DEFAULT_LIMIT);
}
