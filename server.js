import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const require = createRequire(import.meta.url);
const app = express();
const PORT = 8090;
const HOST = "127.0.0.1";
const IS_VERCEL = process.env.VERCEL === "1";
const API_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_ROOT = path.dirname(API_ROOT);
const APPDATA_ROOT = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const SERVERLESS_DATA_DIR = path.join(os.tmpdir(), "simple-python-pos-api", "data");
const APPDATA_DATA_DIR = path.join(APPDATA_ROOT, "SimplePythonPOS", "data");
const PROJECT_DATA_DIR = path.join(PROJECTS_ROOT, "simple-python-pos", "data");
const API_DATA_DIR = path.join(API_ROOT, "data");
const APPDATA_DB_PATH = path.join(APPDATA_DATA_DIR, "pos.db");
const PROJECT_DB_PATH = path.join(PROJECT_DATA_DIR, "pos.db");
const API_SEED_DB_PATH = path.join(API_DATA_DIR, "pos.db");
const SHOULD_USE_PROJECT_DB = process.env.SIMPLE_POS_USE_PROJECT_DB === "1";
const DB_PATH = process.env.SIMPLE_POS_DB_PATH
  ? path.resolve(process.env.SIMPLE_POS_DB_PATH)
  : (IS_VERCEL
      ? path.join(SERVERLESS_DATA_DIR, "pos.db")
      : (SHOULD_USE_PROJECT_DB
      ? PROJECT_DB_PATH
      : (fs.existsSync(APPDATA_DB_PATH) ? APPDATA_DB_PATH : (fs.existsSync(PROJECT_DB_PATH) ? PROJECT_DB_PATH : APPDATA_DB_PATH))));
const DATA_DIR = process.env.SIMPLE_POS_DATA_DIR ? path.resolve(process.env.SIMPLE_POS_DATA_DIR) : path.dirname(DB_PATH);
const BACKUP_DIR = process.env.SIMPLE_POS_BACKUP_DIR ? path.resolve(process.env.SIMPLE_POS_BACKUP_DIR) : path.join(DATA_DIR, "api-backups");
const BRANDING_DIR = path.join(path.dirname(DATA_DIR), "branding");
const APP_RUNTIME_DIR = path.dirname(DATA_DIR);
const TRIAL_FILE = path.join(APP_RUNTIME_DIR, "trial.json");
const TRIAL_DAYS = 30;
const TRIAL_WARNING_DAYS = 7;
const TRIAL_CONTACT_MESSAGE = "Trial expired. Please contact your POS provider to continue using this system.";
const PUBLIC_API_URL = String(process.env.PUBLIC_API_URL || `http://${HOST}:${PORT}`).replace(/\/$/, "");
const PUBLIC_STORE_URL = String(process.env.PUBLIC_STORE_URL || "http://127.0.0.1:8083").replace(/\/$/, "");
const PAYFAST_MODE = String(process.env.PAYFAST_MODE || "sandbox").toLowerCase();
const PAYFAST_MERCHANT_ID = String(process.env.PAYFAST_MERCHANT_ID || "").trim();
const PAYFAST_MERCHANT_KEY = String(process.env.PAYFAST_MERCHANT_KEY || "").trim();
const PAYFAST_PASSPHRASE = String(process.env.PAYFAST_PASSPHRASE || "").trim();
const PAYFAST_REQUIRE_SIGNATURE = String(process.env.PAYFAST_REQUIRE_SIGNATURE || "").trim() === "1";
const AUTH_TOKEN_SECRET = String(process.env.SIMPLE_POS_AUTH_SECRET || "simple-python-pos-vercel-session-secret");
const PAYFAST_PROCESS_URL = PAYFAST_MODE === "live"
  ? "https://www.payfast.co.za/eng/process"
  : "https://sandbox.payfast.co.za/eng/process";
const EXTRA_ALLOWED_ORIGINS = String(process.env.SIMPLE_POS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);
const LOCAL_ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:8083",
  "http://localhost:8083",
  "http://127.0.0.1:8084",
  "http://localhost:8084",
  "http://127.0.0.1:8090",
  "http://localhost:8090",
  "https://patala-pay-webstore.vercel.app",
  "https://patala-pay-webadmin.vercel.app",
  PUBLIC_API_URL,
  PUBLIC_STORE_URL,
  ...EXTRA_ALLOWED_ORIGINS,
]);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(BRANDING_DIR, { recursive: true });

function getTrialStatus() {
  const now = new Date();
  let activatedAt = null;
  let state = {};
  if (fs.existsSync(TRIAL_FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(TRIAL_FILE, "utf8"));
      activatedAt = new Date(String(state.activated_at || "").trim());
      if (Number.isNaN(activatedAt.getTime())) {
        activatedAt = null;
      }
    } catch {
      activatedAt = null;
      state = {};
    }
  }
  if (!activatedAt) {
    activatedAt = now;
    state = { activated_at: activatedAt.toISOString().slice(0, 19) };
    fs.writeFileSync(TRIAL_FILE, JSON.stringify(state, null, 2));
  }
  const elapsedMs = now.getTime() - activatedAt.getTime();
  const elapsedDays = Math.max(0, Math.floor(elapsedMs / (24 * 60 * 60 * 1000)));
  const daysLeft = TRIAL_DAYS - elapsedDays;
  const expired = elapsedDays >= TRIAL_DAYS;
  return {
    activatedAt,
    elapsedDays,
    daysLeft: Math.max(0, daysLeft),
    expired,
    warning: !expired && daysLeft <= TRIAL_WARNING_DAYS,
    message: TRIAL_CONTACT_MESSAGE,
  };
}

if (!fs.existsSync(DB_PATH) && fs.existsSync(API_SEED_DB_PATH)) {
  fs.copyFileSync(API_SEED_DB_PATH, DB_PATH);
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || LOCAL_ALLOWED_ORIGINS.has(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Local POS web access only."));
  },
}));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

app.use((req, res, next) => {
  if (req.path === "/health") {
    return next();
  }
  const trial = getTrialStatus();
  if (trial.expired) {
    return res.status(403).json({
      error: trial.message,
      code: "TRIAL_EXPIRED",
      trial: {
        activatedAt: trial.activatedAt.toISOString(),
        daysLeft: trial.daysLeft,
        expired: true,
      },
    });
  }
  res.locals.trial = trial;
  return next();
});

const SQL = await initSqlJs({
  locateFile(file) {
    if (file === "sql-wasm.wasm") {
      return require.resolve("sql.js/dist/sql-wasm.wasm");
    }
    return file;
  },
});
const sessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ALL_PERMISSIONS = ["dashboard", "users", "products", "suppliers", "customers", "sales", "stock", "cashups", "backup"];
const CASHIER_PERMISSIONS = ["dashboard", "sales", "stock", "cashups"];

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8").toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function signPayload(payload) {
  return crypto.createHmac("sha256", AUTH_TOKEN_SECRET).update(payload).digest("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(secret, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifySecret(secret, storedHash) {
  const raw = String(storedHash ?? "");
  const [salt, hash] = raw.split(":");
  if (!salt || !hash) {
    return false;
  }
  const computed = crypto.scryptSync(secret, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(computed, "hex"));
}

function payFastEncode(value) {
  return encodeURIComponent(String(value ?? "").trim())
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%[0-9a-f]{2}/g, (match) => match.toUpperCase());
}

function payFastSignature(fields, passphrase = PAYFAST_PASSPHRASE) {
  const fieldOrder = [
    "merchant_id",
    "merchant_key",
    "return_url",
    "cancel_url",
    "notify_url",
    "name_first",
    "name_last",
    "email_address",
    "cell_number",
    "m_payment_id",
    "amount",
    "item_name",
    "item_description",
    "custom_int1",
    "custom_int2",
    "custom_int3",
    "custom_int4",
    "custom_int5",
    "custom_str1",
    "custom_str2",
    "custom_str3",
    "custom_str4",
    "custom_str5",
    "email_confirmation",
    "confirmation_address",
    "payment_method",
  ];
  const orderedEntries = fieldOrder
    .filter((key) => Object.prototype.hasOwnProperty.call(fields, key))
    .map((key) => [key, fields[key]]);
  const extraEntries = Object.entries(fields)
    .filter(([key]) => key !== "signature" && !fieldOrder.includes(key))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = [...orderedEntries, ...extraEntries]
    .filter(([key, value]) => key !== "signature" && value !== undefined && value !== null && String(value).trim() !== "")
    .map(([key, value]) => `${key}=${payFastEncode(value)}`)
    .join("&");
  const withPassphrase = passphrase ? `${query}&passphrase=${payFastEncode(passphrase)}` : query;
  return crypto.createHash("md5").update(withPassphrase).digest("hex");
}

function createPayFastCheckout(order) {
  const amount = Number(order.totalAmount || 0).toFixed(2);
  const paymentReference = `PF-${order.orderNumber}`;
  const nameParts = String(order.customerName || "Online Customer").trim().split(/\s+/);
  const fields = {
    merchant_id: PAYFAST_MERCHANT_ID,
    merchant_key: PAYFAST_MERCHANT_KEY,
    return_url: `${PUBLIC_STORE_URL}/#payment-success`,
    cancel_url: `${PUBLIC_STORE_URL}/#payment-cancelled`,
    notify_url: `${PUBLIC_API_URL}/store/payfast/itn`,
    name_first: nameParts[0] || "Online",
    name_last: nameParts.slice(1).join(" ") || "Customer",
    email_address: order.customerEmail || "",
    m_payment_id: paymentReference,
    amount,
    item_name: `Online order ${order.orderNumber}`,
    item_description: `Simple POS online pickup order ${order.orderNumber}`,
    custom_str1: order.orderNumber,
  };
  if (PAYFAST_PASSPHRASE || PAYFAST_REQUIRE_SIGNATURE) {
    fields.signature = payFastSignature(fields);
  }

  writeDatabase((db) => {
    db.run(
      `UPDATE online_orders
       SET payment_provider='PAYFAST', payment_status='INITIATED', payment_reference=?, updated_at=CURRENT_TIMESTAMP
       WHERE order_number=?`,
      [paymentReference, order.orderNumber],
    );
  });

  return {
    provider: "PAYFAST",
    mode: PAYFAST_MODE,
    processUrl: PAYFAST_PROCESS_URL,
    notifyUrl: fields.notify_url,
    returnUrl: fields.return_url,
    cancelUrl: fields.cancel_url,
    fields,
  };
}

function renderPayFastAutoSubmit(checkout) {
  const inputs = Object.entries(checkout.fields)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join("\n");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Redirecting to PayFast</title>
  </head>
  <body>
    <p>Redirecting to PayFast...</p>
    <form id="payfast-form" method="post" action="${escapeHtml(checkout.processUrl)}">
      ${inputs}
      <button type="submit">Continue to PayFast</button>
    </form>
    <script>document.getElementById("payfast-form").submit();</script>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
const BUSINESS_TEMPLATES = {
  supermarket: {
    label: "Supermarket",
    settings: { barcode_mode: true, table_service: false, age_restricted_sales: false, service_charge_enabled: false, departments: ["Groceries", "Bakery", "Dairy", "Drinks", "Snacks", "Household", "Frozen", "Fresh Produce", "Toiletries"] },
    items: [
      ["600100000001", "Coke 500ml", 18.5, 42, "Drinks", "Cold drink"],
      ["600100000002", "Brown Bread", 16.99, 30, "Bakery", "Fresh loaf"],
      ["600100000003", "Full Cream Milk 2L", 34.99, 18, "Dairy", "2 litre milk"],
      ["600100000004", "Potato Chips Salted", 13.5, 25, "Snacks", "125g bag"],
      ["600100000005", "Chocolate Bar", 11.0, 65, "Snacks", "Standard bar"],
      ["600100000006", "White Bread", 15.99, 28, "Bakery", "Fresh loaf"],
      ["600100000007", "Hamburger Buns 6 Pack", 24.99, 16, "Bakery", "Soft buns"],
      ["600100000008", "Eggs Large 18 Pack", 52.99, 20, "Dairy", "Farm fresh eggs"],
      ["600100000009", "Maas 2L", 29.99, 14, "Dairy", "Cultured milk"],
      ["600100000010", "Cheddar Cheese 900g", 84.99, 10, "Dairy", "Mature cheddar"],
      ["600100000011", "Sunflower Oil 2L", 69.99, 15, "Groceries", "Cooking oil"],
      ["600100000012", "Sugar 2.5kg", 49.99, 19, "Groceries", "White sugar"],
      ["600100000013", "Rice 5kg", 96.99, 13, "Groceries", "Long grain rice"],
      ["600100000014", "Maize Meal 5kg", 62.99, 17, "Groceries", "Super maize meal"],
      ["600100000015", "Baked Beans 410g", 18.99, 36, "Groceries", "Tomato sauce beans"],
      ["600100000016", "Coke 2L", 27.99, 22, "Drinks", "Soft drink"],
      ["600100000017", "Orange Juice 1L", 24.99, 18, "Drinks", "Fruit juice"],
      ["600100000018", "Still Water 1.5L", 12.99, 40, "Drinks", "Bottled water"],
      ["600100000019", "Energy Drink 440ml", 22.99, 26, "Drinks", "Energy beverage"],
      ["600100000020", "Salted Peanuts 150g", 19.99, 22, "Snacks", "Roasted peanuts"],
      ["600100000021", "Cream Biscuits 200g", 16.99, 31, "Snacks", "Tea biscuits"],
      ["600100000022", "Frozen Chicken Portions 2kg", 129.99, 12, "Frozen", "IQF chicken"],
      ["600100000023", "Frozen Mixed Veg 1kg", 34.99, 14, "Frozen", "Vegetable mix"],
      ["600100000024", "Apples 1kg", 29.99, 20, "Fresh Produce", "Fresh apples"],
      ["600100000025", "Bananas 1kg", 24.99, 24, "Fresh Produce", "Fresh bananas"],
      ["600100000026", "Tomatoes 1kg", 21.99, 18, "Fresh Produce", "Salad tomatoes"],
      ["600100000027", "Potatoes 7kg", 74.99, 11, "Fresh Produce", "Washed potatoes"],
      ["600100000028", "Dishwashing Liquid 750ml", 28.99, 21, "Household", "Lemon dishwashing liquid"],
      ["600100000029", "Washing Powder 2kg", 89.99, 12, "Household", "Laundry detergent"],
      ["600100000030", "Toilet Paper 18 Pack", 109.99, 14, "Household", "2-ply tissue"],
      ["600100000031", "Bath Soap 3 Pack", 22.99, 30, "Toiletries", "Family soap pack"],
      ["600100000032", "Toothpaste 100ml", 19.99, 27, "Toiletries", "Mint toothpaste"],
      ["600100000033", "Shampoo 400ml", 39.99, 16, "Toiletries", "Everyday shampoo"],
    ],
    customers: [["CASH", "Walk-in Customer", "", 0, 0], ["CUST001", "John Dlamini", "0710000001", 500, 0]],
    suppliers: [["SUP001", "Main Grocery Supplier", "0711111111", "orders@grocery.test", "Alice"], ["SUP002", "Drinks Wholesale", "0722222222", "sales@drinks.test", "Brian"]],
  },
  restaurant: {
    label: "Restaurant",
    settings: { barcode_mode: false, table_service: true, age_restricted_sales: false, service_charge_enabled: true, departments: ["Starters", "Mains", "Sides", "Desserts", "Soft Drinks", "Hot Drinks", "Kids", "Breakfast"] },
    items: [["RST001", "Burger Meal", 89.9, 40, "Mains", "Burger with fries"], ["RST002", "Chicken Wrap", 74.9, 30, "Mains", "Grilled chicken wrap"], ["RST003", "Greek Salad", 59.9, 20, "Starters", "Fresh salad bowl"], ["RST004", "Cheesecake Slice", 42, 15, "Desserts", "Baked cheesecake"], ["RST005", "Cappuccino", 32, 50, "Hot Drinks", "Regular cappuccino"], ["RST006", "Breakfast Special", 69.9, 25, "Breakfast", "Eggs bacon toast"], ["RST007", "French Toast Stack", 54.9, 18, "Breakfast", "Maple syrup stack"], ["RST008", "Chicken Wings 6", 72.9, 24, "Starters", "Sticky wings"], ["RST009", "Garlic Bread", 36.9, 20, "Starters", "Toasted garlic bread"], ["RST010", "Club Sandwich", 78.9, 20, "Mains", "Triple decker sandwich"], ["RST011", "Rib Burger", 96.9, 16, "Mains", "BBQ rib burger"], ["RST012", "Margherita Pizza", 84.9, 18, "Mains", "Classic pizza"], ["RST013", "Chicken Pasta", 88.9, 15, "Mains", "Creamy chicken pasta"], ["RST014", "Fries", 29.9, 35, "Sides", "Crispy fries"], ["RST015", "Onion Rings", 34.9, 22, "Sides", "Beer battered"], ["RST016", "Ice Cream Sundae", 39.9, 18, "Desserts", "Vanilla sundae"], ["RST017", "Chocolate Brownie", 44.9, 15, "Desserts", "Warm brownie"], ["RST018", "Cola 300ml", 24.9, 40, "Soft Drinks", "Cold soft drink"], ["RST019", "Orange Juice Glass", 28.9, 24, "Soft Drinks", "Fresh juice"], ["RST020", "Milkshake Chocolate", 42.9, 20, "Soft Drinks", "Chocolate shake"], ["RST021", "Tea", 24.9, 35, "Hot Drinks", "Five Roses tea"], ["RST022", "Hot Chocolate", 38.9, 26, "Hot Drinks", "Rich hot chocolate"], ["RST023", "Kids Burger", 49.9, 20, "Kids", "Kids beef burger"], ["RST024", "Kids Nuggets", 46.9, 20, "Kids", "Chicken nuggets"]],
    customers: [["WALKIN", "Walk-in Guest", "", 0, 0]],
    suppliers: [["SUPR01", "Fresh Produce Supply", "0713333333", "orders@produce.test", "Mpho"], ["SUPR02", "Restaurant Foods", "0714444444", "sales@restfoods.test", "Sam"]],
  },
  bottlestore: {
    label: "Bottle Store",
    settings: { barcode_mode: true, table_service: false, age_restricted_sales: true, service_charge_enabled: false, departments: ["Beer", "Wine", "Spirits", "Ciders", "Mixers", "Snacks"] },
    items: [["BOT001", "Castle Lager 6 Pack", 89.99, 35, "Beer", "6 x 330ml"], ["BOT002", "Savanna Dry 6 Pack", 104.99, 22, "Beer", "6 x 330ml"], ["BOT003", "Four Cousins Red", 79.99, 18, "Wine", "750ml bottle"], ["BOT004", "Smirnoff Vodka 750ml", 159.99, 14, "Spirits", "Vodka bottle"], ["BOT005", "Coke 2L", 27.99, 25, "Mixers", "Soft drink mixer"], ["BOT006", "Black Label 6 Pack", 96.99, 24, "Beer", "6 x 330ml"], ["BOT007", "Heineken 6 Pack", 119.99, 18, "Beer", "Premium lager"], ["BOT008", "Brutal Fruit Ruby Apple 6 Pack", 106.99, 16, "Ciders", "Flavoured cider"], ["BOT009", "Hunters Dry 6 Pack", 109.99, 19, "Ciders", "Dry cider"], ["BOT010", "JC Le Roux Le Domaine", 94.99, 12, "Wine", "Sparkling wine"], ["BOT011", "Drostdy Hof Claret", 74.99, 15, "Wine", "Red wine"], ["BOT012", "Nederburg Rose", 89.99, 11, "Wine", "Rose wine"], ["BOT013", "Jameson Irish Whiskey 750ml", 329.99, 8, "Spirits", "Irish whiskey"], ["BOT014", "Captain Morgan Gold 750ml", 189.99, 9, "Spirits", "Spiced rum"], ["BOT015", "Gordon's Gin 750ml", 179.99, 10, "Spirits", "London dry gin"], ["BOT016", "Tonic Water 1L", 19.99, 20, "Mixers", "Indian tonic"], ["BOT017", "Lemonade 2L", 23.99, 16, "Mixers", "Soft drink mixer"], ["BOT018", "Ice Cubes 2kg", 28.99, 14, "Mixers", "Party ice"], ["BOT019", "Beef Biltong 100g", 44.99, 18, "Snacks", "Sliced biltong"], ["BOT020", "Drywors 100g", 39.99, 16, "Snacks", "Traditional drywors"], ["BOT021", "Salted Cashews 150g", 49.99, 14, "Snacks", "Premium nuts"]],
    customers: [["CASH", "Walk-in Customer", "", 0, 0], ["LOYAL01", "Bottle Store Account", "0718888888", 1000, 0]],
    suppliers: [["SUPB01", "Liquor Wholesale SA", "0715555555", "orders@liquor.test", "Chris"], ["SUPB02", "Mixers Direct", "0716666666", "sales@mixers.test", "Lee"]],
  },
  hardware: {
    label: "Hardware Store",
    settings: { barcode_mode: true, table_service: false, age_restricted_sales: false, service_charge_enabled: false, departments: ["Tools", "Paint", "Fasteners", "Electrical", "Plumbing", "Garden", "Adhesives", "Safety"] },
    items: [["HRD001", "Claw Hammer", 129.99, 18, "Tools", "Steel hammer"], ["HRD002", "Screwdriver Set", 159.99, 12, "Tools", "6-piece set"], ["HRD003", "Wall Plug Pack", 39.99, 50, "Fasteners", "Mixed pack"], ["HRD004", "White Paint 5L", 299.99, 10, "Paint", "Interior paint"], ["HRD005", "PVC Pipe 3m", 89.99, 25, "Plumbing", "Standard PVC pipe"], ["HRD006", "Tape Measure 5m", 69.99, 20, "Tools", "Locking tape"], ["HRD007", "Adjustable Spanner", 119.99, 15, "Tools", "Chrome spanner"], ["HRD008", "Cordless Drill 18V", 1299.99, 6, "Tools", "Battery drill kit"], ["HRD009", "Paint Brush 50mm", 34.99, 24, "Paint", "Synthetic brush"], ["HRD010", "Paint Roller Set", 84.99, 16, "Paint", "Tray and roller"], ["HRD011", "Wood Screws 50mm 100 Pack", 79.99, 28, "Fasteners", "Countersunk screws"], ["HRD012", "Nails 75mm 1kg", 59.99, 22, "Fasteners", "Steel nails"], ["HRD013", "Extension Lead 5m", 129.99, 14, "Electrical", "4-way extension"], ["HRD014", "LED Bulb 9W", 39.99, 30, "Electrical", "Warm white bulb"], ["HRD015", "Double Plug Socket", 54.99, 18, "Electrical", "Wall socket"], ["HRD016", "PVC Elbow 50mm", 16.99, 35, "Plumbing", "Pipe fitting"], ["HRD017", "Tap Washer Set", 24.99, 20, "Plumbing", "Rubber washers"], ["HRD018", "Garden Hose 20m", 249.99, 10, "Garden", "Reinforced hose"], ["HRD019", "Pruning Shears", 149.99, 12, "Garden", "Bypass pruner"], ["HRD020", "Silicone Sealant Clear", 64.99, 19, "Adhesives", "General sealant"], ["HRD021", "Super Glue 3g", 19.99, 40, "Adhesives", "Quick bond glue"], ["HRD022", "Work Gloves Pair", 49.99, 25, "Safety", "Grip gloves"], ["HRD023", "Safety Goggles", 79.99, 14, "Safety", "Clear lens goggles"]],
    customers: [["CASH", "Walk-in Customer", "", 0, 0], ["ACC001", "Builder Account", "0719999999", 5000, 0]],
    suppliers: [["SUPH01", "Builders Supply Co", "0717777777", "orders@builders.test", "Peter"], ["SUPH02", "Tool Warehouse", "0720000000", "sales@tools.test", "Nandi"]],
  },
  autospares: {
    label: "Auto Spares",
    settings: { barcode_mode: true, table_service: false, age_restricted_sales: false, service_charge_enabled: false, departments: ["Engine Parts", "Filters", "Brakes", "Electrical", "Oils & Fluids", "Accessories", "Suspension", "Tools"] },
    items: [["ASP001", "Spark Plug NGK", 59.99, 30, "Engine Parts", "Single spark plug"], ["ASP002", "Oil Filter Toyota", 89.99, 24, "Filters", "Spin-on oil filter"], ["ASP003", "Air Filter Toyota Corolla", 129.99, 18, "Filters", "Engine air filter"], ["ASP004", "Brake Pads Front VW Polo", 349.99, 14, "Brakes", "Front brake pad set"], ["ASP005", "Brake Disc Front Single", 429.99, 12, "Brakes", "Single vented brake disc"], ["ASP006", "12V Car Battery 652", 1499.99, 8, "Electrical", "Maintenance free battery"], ["ASP007", "Headlight Bulb H7", 79.99, 35, "Electrical", "12V halogen bulb"], ["ASP008", "Alternator Belt 6PK", 189.99, 16, "Engine Parts", "Multi-rib belt"], ["ASP009", "Engine Oil 5W30 5L", 499.99, 20, "Oils & Fluids", "Synthetic engine oil"], ["ASP010", "Coolant 5L", 159.99, 22, "Oils & Fluids", "Ready mix coolant"], ["ASP011", "Brake Fluid DOT4 500ml", 89.99, 20, "Oils & Fluids", "Brake fluid bottle"], ["ASP012", "Wiper Blade 18 inch", 99.99, 25, "Accessories", "Single wiper blade"], ["ASP013", "Wiper Blade 21 inch", 109.99, 22, "Accessories", "Single wiper blade"], ["ASP014", "Car Air Freshener", 29.99, 40, "Accessories", "Hanging freshener"], ["ASP015", "Wheel Bearing Front", 399.99, 10, "Suspension", "Front wheel bearing kit"], ["ASP016", "Shock Absorber Front", 899.99, 8, "Suspension", "Front shock absorber"], ["ASP017", "Ball Joint Lower", 249.99, 14, "Suspension", "Lower ball joint"], ["ASP018", "Jack Stand Pair 2T", 699.99, 6, "Tools", "Pair of jack stands"], ["ASP019", "Wheel Spanner", 139.99, 15, "Tools", "Cross wheel spanner"], ["ASP020", "Battery Terminal Set", 69.99, 28, "Electrical", "Positive and negative terminals"], ["ASP021", "Fuse Assortment Pack", 54.99, 26, "Electrical", "Mixed blade fuses"], ["ASP022", "Cabin Filter", 149.99, 14, "Filters", "Interior pollen filter"]],
    customers: [["CASH", "Walk-in Customer", "", 0, 0], ["FLEET01", "Fleet Account", "0721111111", 15000, 0]],
    suppliers: [["SUPA01", "Motor Parts Direct", "0711234567", "orders@motorparts.test", "Thabo"], ["SUPA02", "Auto Electrical Hub", "0722345678", "sales@autoelectrical.test", "Naledi"]],
  },
};

function readDatabase() {
  const fileBuffer = fs.readFileSync(DB_PATH);
  return new SQL.Database(fileBuffer);
}

function ensureSchema() {
  writeDatabase((db) => {
    const columnsStmt = db.prepare("PRAGMA table_info(cashiers)");
    const columns = [];
    while (columnsStmt.step()) {
      columns.push(columnsStmt.getAsObject().name);
    }
    columnsStmt.free();

    if (!columns.includes("web_permissions")) {
      db.run("ALTER TABLE cashiers ADD COLUMN web_permissions TEXT");
      db.run("UPDATE cashiers SET web_permissions=? WHERE username='admin'", [JSON.stringify(ALL_PERMISSIONS)]);
      db.run("UPDATE cashiers SET web_permissions=? WHERE username<>'admin' OR username IS NULL", [JSON.stringify(CASHIER_PERMISSIONS)]);
    }

    const itemColumnsStmt = db.prepare("PRAGMA table_info(items)");
    const itemColumns = [];
    while (itemColumnsStmt.step()) {
      itemColumns.push(itemColumnsStmt.getAsObject().name);
    }
    itemColumnsStmt.free();
    if (!itemColumns.includes("is_active")) {
      db.run("ALTER TABLE items ADD COLUMN is_active INTEGER DEFAULT 1");
      db.run("UPDATE items SET is_active=1 WHERE is_active IS NULL");
    }
    if (!itemColumns.includes("image_url")) {
      db.run("ALTER TABLE items ADD COLUMN image_url TEXT DEFAULT ''");
      db.run("UPDATE items SET image_url='' WHERE image_url IS NULL");
    }

    const supplierColumnsStmt = db.prepare("PRAGMA table_info(suppliers)");
    const supplierColumns = [];
    while (supplierColumnsStmt.step()) {
      supplierColumns.push(supplierColumnsStmt.getAsObject().name);
    }
    supplierColumnsStmt.free();
    if (!supplierColumns.includes("is_active")) {
      db.run("ALTER TABLE suppliers ADD COLUMN is_active INTEGER DEFAULT 1");
      db.run("UPDATE suppliers SET is_active=1 WHERE is_active IS NULL");
    }
    db.run("CREATE TABLE IF NOT EXISTS business_profile (id INTEGER PRIMARY KEY CHECK (id = 1), business_type TEXT NOT NULL DEFAULT 'supermarket', business_name TEXT NOT NULL DEFAULT 'My Store', settings_json TEXT NOT NULL DEFAULT '{}', applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    const businessColumnsStmt = db.prepare("PRAGMA table_info(business_profile)");
    const businessColumns = [];
    while (businessColumnsStmt.step()) {
      businessColumns.push(businessColumnsStmt.getAsObject().name);
    }
    businessColumnsStmt.free();
    if (!businessColumns.includes("logo_url")) {
      db.run("ALTER TABLE business_profile ADD COLUMN logo_url TEXT DEFAULT ''");
      db.run("UPDATE business_profile SET logo_url='' WHERE logo_url IS NULL");
    }
    if (!businessColumns.includes("business_address")) {
      db.run("ALTER TABLE business_profile ADD COLUMN business_address TEXT DEFAULT ''");
      db.run("UPDATE business_profile SET business_address='' WHERE business_address IS NULL");
    }
    if (!businessColumns.includes("business_phone")) {
      db.run("ALTER TABLE business_profile ADD COLUMN business_phone TEXT DEFAULT ''");
      db.run("UPDATE business_profile SET business_phone='' WHERE business_phone IS NULL");
    }
    if (!businessColumns.includes("card_charge_amount")) {
      db.run("ALTER TABLE business_profile ADD COLUMN card_charge_amount REAL NOT NULL DEFAULT 0");
      db.run("UPDATE business_profile SET card_charge_amount=0 WHERE card_charge_amount IS NULL");
    }
    if (!businessColumns.includes("card_charge_enabled")) {
      db.run("ALTER TABLE business_profile ADD COLUMN card_charge_enabled INTEGER NOT NULL DEFAULT 0");
      db.run("UPDATE business_profile SET card_charge_enabled=0 WHERE card_charge_enabled IS NULL");
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS customer_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        paid_at TEXT NOT NULL,
        recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        cashier_id INTEGER,
        cashier_name TEXT DEFAULT '',
        notes TEXT DEFAULT ''
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS customer_account_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        entry_type TEXT NOT NULL,
        reference_no TEXT DEFAULT '',
        entry_date TEXT NOT NULL,
        description TEXT DEFAULT '',
        debit_amount REAL NOT NULL DEFAULT 0,
        credit_amount REAL NOT NULL DEFAULT 0,
        discount_amount REAL NOT NULL DEFAULT 0,
        balance_after REAL NOT NULL DEFAULT 0,
        sale_id INTEGER,
        payment_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS discounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discount_code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `);
    const businessCount = db.exec("SELECT COUNT(*) AS count FROM business_profile");
    const count = businessCount?.[0]?.values?.[0]?.[0] ?? 0;
    if (count === 0) {
      db.run("INSERT INTO business_profile (id, business_type, business_name, settings_json, applied_at) VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)", [
        "supermarket",
        BUSINESS_TEMPLATES.supermarket.label,
        JSON.stringify(BUSINESS_TEMPLATES.supermarket.settings),
      ]);
    }
    db.run(`
      CREATE TABLE IF NOT EXISTS supplier_invoice_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER,
        supplier_name TEXT DEFAULT '',
        invoice_number TEXT DEFAULT '',
        invoice_date TEXT DEFAULT '',
        total_amount REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        source_type TEXT NOT NULL DEFAULT 'MANUAL_TEXT',
        raw_text TEXT DEFAULT '',
        parse_notes TEXT DEFAULT '',
        created_by TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        approved_at TEXT DEFAULT ''
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS supplier_invoice_draft_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        draft_id INTEGER NOT NULL,
        line_no INTEGER NOT NULL DEFAULT 1,
        raw_description TEXT DEFAULT '',
        qty REAL NOT NULL DEFAULT 0,
        unit_price REAL NOT NULL DEFAULT 0,
        line_total REAL NOT NULL DEFAULT 0,
        matched_item_id INTEGER,
        matched_barcode TEXT DEFAULT '',
        matched_item_name TEXT DEFAULT '',
        match_confidence REAL NOT NULL DEFAULT 0,
        review_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW'
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS online_customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS online_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        online_customer_id INTEGER,
        order_number TEXT UNIQUE NOT NULL,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        customer_email TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'PENDING',
        total_amount REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        collected_at TEXT DEFAULT '',
        reserved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS online_order_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        barcode TEXT NOT NULL,
        item_name TEXT NOT NULL,
        qty INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        line_total REAL NOT NULL
      )
    `);
    const orderColumnsStmt = db.prepare("PRAGMA table_info(online_orders)");
    const orderColumns = [];
    while (orderColumnsStmt.step()) {
      orderColumns.push(orderColumnsStmt.getAsObject().name);
    }
    orderColumnsStmt.free();
    if (!orderColumns.includes("online_customer_id")) {
      db.run("ALTER TABLE online_orders ADD COLUMN online_customer_id INTEGER");
    }
    if (!orderColumns.includes("payment_provider")) {
      db.run("ALTER TABLE online_orders ADD COLUMN payment_provider TEXT DEFAULT ''");
    }
    if (!orderColumns.includes("payment_status")) {
      db.run("ALTER TABLE online_orders ADD COLUMN payment_status TEXT DEFAULT 'UNPAID'");
      db.run("UPDATE online_orders SET payment_status='UNPAID' WHERE payment_status IS NULL OR payment_status=''");
    }
    if (!orderColumns.includes("payment_reference")) {
      db.run("ALTER TABLE online_orders ADD COLUMN payment_reference TEXT DEFAULT ''");
    }
    if (!orderColumns.includes("payfast_payment_id")) {
      db.run("ALTER TABLE online_orders ADD COLUMN payfast_payment_id TEXT DEFAULT ''");
    }
    if (!orderColumns.includes("paid_at")) {
      db.run("ALTER TABLE online_orders ADD COLUMN paid_at TEXT DEFAULT ''");
    }
    const salesColumnsStmt = db.prepare("PRAGMA table_info(sales)");
    const salesColumns = [];
    while (salesColumnsStmt.step()) {
      salesColumns.push(salesColumnsStmt.getAsObject().name);
    }
    salesColumnsStmt.free();
    if (!salesColumns.includes("card_charge_amount")) {
      db.run("ALTER TABLE sales ADD COLUMN card_charge_amount REAL NOT NULL DEFAULT 0");
    }
    if (!salesColumns.includes("discount_code")) {
      db.run("ALTER TABLE sales ADD COLUMN discount_code TEXT DEFAULT ''");
    }
    if (!salesColumns.includes("discount_name")) {
      db.run("ALTER TABLE sales ADD COLUMN discount_name TEXT DEFAULT ''");
    }
    if (!salesColumns.includes("discount_amount")) {
      db.run("ALTER TABLE sales ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0");
    }
  });
}

function query(sql, params = []) {
  const db = readDatabase();
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  } finally {
    db.close();
  }
}

const getAll = (sql, params = []) => query(sql, params);
const getOne = (sql, params = []) => query(sql, params)[0] ?? {};

function writeDatabase(callback) {
  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);
  try {
    db.run("BEGIN TRANSACTION");
    const result = callback(db);
    db.run("COMMIT");
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
    return result;
  } catch (error) {
    try {
      db.run("ROLLBACK");
    } catch (_rollbackError) {
      // Ignore rollback errors and surface the original problem.
    }
    throw error;
  } finally {
    db.close();
  }
}

ensureSchema();
reconcilePaidOnlineOrderSales();

function createSession(user, type = "staff") {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = base64UrlEncode(JSON.stringify({
    user,
    type,
    expiresAt,
  }));
  const token = `${payload}.${signPayload(payload)}`;
  sessions.set(token, {
    user,
    type,
    expiresAt,
  });
  return token;
}

function publicTrial(trial) {
  return {
    activatedAt: trial.activatedAt.toISOString(),
    daysLeft: trial.daysLeft,
    expired: trial.expired,
    warning: trial.warning,
    message: trial.message,
  };
}

function getSession(token, type = null) {
  let session = sessions.get(token);
  if (!session) {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature || signature !== signPayload(payload)) {
      return null;
    }
    try {
      session = JSON.parse(base64UrlDecode(payload));
    } catch (_error) {
      return null;
    }
  }
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  if (type && session.type !== type) {
    return null;
  }
  return session;
}

function authTokenFromRequest(req) {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function authRequired(req, res, next) {
  const token = authTokenFromRequest(req);
  const session = getSession(token, "staff");
  if (!session) {
    return res.status(401).json({ error: "Authentication required." });
  }
  req.user = session.user;
  return next();
}

function storeCustomerAuthRequired(req, res, next) {
  const token = authTokenFromRequest(req);
  const session = getSession(token, "store-customer");
  if (!session) {
    return res.status(401).json({ error: "Store customer authentication required." });
  }
  req.storeCustomer = session.user;
  return next();
}

function optionalStoreCustomer(req, _res, next) {
  const token = authTokenFromRequest(req);
  const session = token ? getSession(token, "store-customer") : null;
  req.storeCustomer = session?.user ?? null;
  return next();
}

function adminRequired(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  return next();
}

function permissionRequired(permission) {
  return (req, res, next) => {
    if (req.user?.role === "admin") {
      return next();
    }
    if (!req.user?.permissions?.includes(permission)) {
      return res.status(403).json({ error: `Permission required: ${permission}` });
    }
    return next();
  };
}

function permissionAnyRequired(...requiredPermissions) {
  return (req, res, next) => {
    if (req.user?.role === "admin") {
      return next();
    }
    if (requiredPermissions.some((permission) => req.user?.permissions?.includes(permission))) {
      return next();
    }
    return res.status(403).json({ error: `One of these permissions is required: ${requiredPermissions.join(", ")}` });
  };
}

function normalizePermissions(permissions, username) {
  if (username === "admin") {
    return [...ALL_PERMISSIONS];
  }
  const list = Array.isArray(permissions) ? permissions : CASHIER_PERMISSIONS;
  return [...new Set(list.filter((item) => ALL_PERMISSIONS.includes(item) && item !== "users" && item !== "backup"))];
}

function parsePermissions(rawValue, username) {
  if (username === "admin") {
    return [...ALL_PERMISSIONS];
  }
  if (!rawValue) {
    return [...CASHIER_PERMISSIONS];
  }
  try {
    return normalizePermissions(JSON.parse(rawValue), username);
  } catch (_error) {
    return [...CASHIER_PERMISSIONS];
  }
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.username === "admin" ? "admin" : "cashier",
    permissions: parsePermissions(user.web_permissions, user.username),
  };
}

function listUsers() {
  return getAll(`
    SELECT id, username, display_name AS displayName, is_active AS isActive, web_permissions AS webPermissions
    FROM cashiers
    ORDER BY username
  `).map((user) => ({
    ...user,
    role: user.username === "admin" ? "admin" : "cashier",
    isActive: Number(user.isActive) === 1,
    permissions: parsePermissions(user.webPermissions, user.username),
  }));
}

function expireAdminSessions() {
  for (const [token, session] of sessions.entries()) {
    if (session.user?.username === "admin") {
      sessions.delete(token);
    }
  }
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calculateCustomerOverdue(ledgerRows, todayValue = formatLocalDate()) {
  const queue = [];
  for (const row of ledgerRows) {
    const debit = Math.round(asNumber(row.debitAmount, 0) * 100) / 100;
    const credit = Math.round(asNumber(row.creditAmount, 0) * 100) / 100;
    const entryDate = String(row.entryDate ?? "").slice(0, 10);
    if (debit > 0 && entryDate) {
      queue.push({ remaining: debit, entryDate });
    }
    if (credit > 0) {
      let remainingCredit = credit;
      while (remainingCredit > 0 && queue.length) {
        const oldest = queue[0];
        const applied = Math.min(oldest.remaining, remainingCredit);
        oldest.remaining = Math.round((oldest.remaining - applied) * 100) / 100;
        remainingCredit = Math.round((remainingCredit - applied) * 100) / 100;
        if (oldest.remaining <= 0.0001) {
          queue.shift();
        }
      }
    }
  }

  const today = new Date(`${todayValue}T00:00:00`);
  if (Number.isNaN(today.getTime())) {
    return {
      overdue: false,
      overdueAmount: 0,
      overdueDays: 0,
      oldestOutstandingDate: "",
      statusLabel: "Current",
    };
  }

  let overdueAmount = 0;
  let oldestOutstandingDate = "";
  let overdueDays = 0;
  for (const item of queue) {
    const openedAt = new Date(`${item.entryDate}T00:00:00`);
    if (Number.isNaN(openedAt.getTime())) {
      continue;
    }
    const ageDays = Math.floor((today.getTime() - openedAt.getTime()) / (24 * 60 * 60 * 1000));
    if (ageDays > 30 && item.remaining > 0) {
      overdueAmount += item.remaining;
      if (!oldestOutstandingDate || item.entryDate < oldestOutstandingDate) {
        oldestOutstandingDate = item.entryDate;
        overdueDays = ageDays - 30;
      }
    }
  }

  overdueAmount = Math.round(overdueAmount * 100) / 100;
  overdueDays = Math.max(0, overdueDays);
  return {
    overdue: overdueAmount > 0,
    overdueAmount,
    overdueDays,
    oldestOutstandingDate,
    statusLabel: overdueAmount > 0 ? `Overdue by ${overdueDays} day${overdueDays === 1 ? "" : "s"}` : "Current",
  };
}

function getCustomersWithOverdue() {
  const customers = getAll(`
    SELECT id, customer_code AS code, name, phone, email, address, credit_limit AS creditLimit, balance, is_active AS isActive
    FROM customers
    ORDER BY name
  `);
  return customers.map((customer) => {
    const ledgerRows = getAll(`
      SELECT entry_date AS entryDate, debit_amount AS debitAmount, credit_amount AS creditAmount
      FROM customer_account_entries
      WHERE customer_id=?
      ORDER BY datetime(entry_date) ASC, id ASC
    `, [customer.id]);
    return {
      ...customer,
      ...calculateCustomerOverdue(ledgerRows),
    };
  });
}

function cleanupSessions() {
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < Date.now()) {
      sessions.delete(token);
    }
  }
}

function getBusinessProfile() {
  const row = getOne("SELECT business_type AS businessType, business_name AS businessName, logo_url AS logoUrl, business_address AS businessAddress, business_phone AS businessPhone, card_charge_amount AS cardChargeAmount, card_charge_enabled AS cardChargeEnabled, settings_json AS settingsJson, applied_at AS appliedAt FROM business_profile WHERE id=1");
  return {
    businessType: row.businessType || "supermarket",
    businessName: row.businessName || BUSINESS_TEMPLATES.supermarket.label,
    logoUrl: row.logoUrl || "",
    businessAddress: row.businessAddress || "",
    businessPhone: row.businessPhone || "",
    cardChargeAmount: asNumber(row.cardChargeAmount, 0),
    cardChargeEnabled: asInteger(row.cardChargeEnabled, 0) === 1,
    settings: JSON.parse(row.settingsJson || "{}"),
    appliedAt: row.appliedAt || "",
  };
}

function persistBusinessLogo(logoValue) {
  const candidate = String(logoValue || "").trim();
  if (!candidate) return "";
  if (candidate.startsWith("data:image/")) {
    const match = candidate.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return "";
    const mime = match[1].toLowerCase();
    const encoded = match[2];
    const ext = ({
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/gif": ".gif",
      "image/bmp": ".bmp",
      "image/webp": ".webp",
    })[mime] || ".png";
    const target = path.join(BRANDING_DIR, `business-logo${ext}`);
    fs.writeFileSync(target, Buffer.from(encoded, "base64"));
    return target;
  }
  if (fs.existsSync(candidate)) {
    const ext = path.extname(candidate) || ".png";
    const target = path.join(BRANDING_DIR, `business-logo${ext}`);
    fs.copyFileSync(candidate, target);
    return target;
  }
  return candidate;
}

function getDaySummary(dateStr) {
  return getOne(`
    SELECT
      COALESCE(SUM(CASE WHEN sale_type='SALE' AND status='COMPLETED' THEN total_amount ELSE 0 END),0) AS totalSales,
      COALESCE(SUM(CASE WHEN sale_type='SALE' AND status='COMPLETED' THEN 1 ELSE 0 END),0) AS saleCount,
      COALESCE(SUM(CASE WHEN sale_type='RETURN' AND status='COMPLETED' THEN ABS(total_amount) ELSE 0 END),0) AS totalReturns,
      COALESCE(SUM(CASE WHEN sale_type='RETURN' AND status='COMPLETED' THEN 1 ELSE 0 END),0) AS returnCount,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN total_amount ELSE 0 END),0) AS netTotal,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN cash_amount ELSE 0 END),0) AS expectedCash,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN card_amount ELSE 0 END),0) AS expectedCard,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN eft_amount ELSE 0 END),0) AS expectedEft,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN card_charge_amount ELSE 0 END),0) AS cardCharges
    FROM sales
    WHERE substr(created_at,1,10)=?
  `, [dateStr]);
}

function detectSupplierIdByName(name) {
  const cleaned = String(name ?? "").trim().toLowerCase();
  if (!cleaned) {
    return null;
  }
  const suppliers = getAll("SELECT id, name FROM suppliers WHERE is_active=1 ORDER BY name");
  return suppliers.find((supplier) => cleaned.includes(String(supplier.name).toLowerCase()) || String(supplier.name).toLowerCase().includes(cleaned))?.id ?? null;
}

function findProductMatch(rawDescription) {
  const cleaned = String(rawDescription ?? "").trim().toLowerCase();
  if (!cleaned) {
    return null;
  }
  const rows = getAll("SELECT id, barcode, name FROM items WHERE is_active=1 ORDER BY name");
  const exact = rows.find((item) => cleaned === String(item.barcode).toLowerCase() || cleaned === String(item.name).toLowerCase());
  if (exact) {
    return { ...exact, confidence: 1 };
  }
  const partial = rows.find((item) => cleaned.includes(String(item.name).toLowerCase()) || String(item.name).toLowerCase().includes(cleaned));
  if (partial) {
    return { ...partial, confidence: 0.7 };
  }
  return null;
}

function parseInvoiceText(rawText) {
  const text = String(rawText ?? "").replace(/\r/g, "");
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const draft = {
    supplierName: "",
    invoiceNumber: "",
    invoiceDate: "",
    totalAmount: 0,
    parseNotes: "Local draft parser used. Replace with Google Document AI later for PDF/image extraction.",
    lines: [],
  };

  for (const line of lines) {
    const totalMatch = line.match(/(?:total|amount due|invoice total)[:\s]*r?\s*([0-9]+(?:[.,][0-9]{2})?)/i);
    if (totalMatch && !draft.totalAmount) {
      draft.totalAmount = asNumber(totalMatch[1].replace(",", "."), 0);
    }
    const invoiceMatch = line.match(/(?:invoice|inv)\s*(?:no|number|#)?[:\s-]*([A-Z0-9-]+)/i);
    if (invoiceMatch && !draft.invoiceNumber) {
      draft.invoiceNumber = invoiceMatch[1];
    }
    const dateMatch = line.match(/\b(\d{4}-\d{2}-\d{2}|\d{2}[\/-]\d{2}[\/-]\d{4})\b/);
    if (dateMatch && !draft.invoiceDate) {
      draft.invoiceDate = dateMatch[1];
    }
    if (!draft.supplierName && !/invoice|tax|vat|qty|total|amount|date/i.test(line) && line.length > 4) {
      draft.supplierName = line.slice(0, 120);
    }

    const itemMatch = line.match(/^(\d+(?:[.,]\d+)?)\s+(.*?)\s+([0-9]+(?:[.,][0-9]{2})?)\s+([0-9]+(?:[.,][0-9]{2})?)$/);
    if (itemMatch) {
      const qty = asNumber(itemMatch[1].replace(",", "."), 0);
      const description = itemMatch[2].trim();
      const unitPrice = asNumber(itemMatch[3].replace(",", "."), 0);
      const lineTotal = asNumber(itemMatch[4].replace(",", "."), 0);
      const match = findProductMatch(description);
      draft.lines.push({
        rawDescription: description,
        qty,
        unitPrice,
        lineTotal,
        matchedItemId: match?.id ?? null,
        matchedBarcode: match?.barcode ?? "",
        matchedItemName: match?.name ?? "",
        matchConfidence: match?.confidence ?? 0,
        reviewStatus: match ? "MATCHED" : "NEEDS_REVIEW",
      });
    }
  }

  if (!draft.lines.length) {
    draft.parseNotes = `${draft.parseNotes} No line items were detected automatically. Add lines manually in review.`;
  }
  if (!draft.totalAmount) {
    draft.totalAmount = draft.lines.reduce((sum, line) => sum + asNumber(line.lineTotal, 0), 0);
  }
  return draft;
}

function getInvoiceDrafts() {
  return getAll(`
    SELECT d.id, d.supplier_id AS supplierId, d.supplier_name AS supplierName, d.invoice_number AS invoiceNumber,
           d.invoice_date AS invoiceDate, d.total_amount AS totalAmount, d.status, d.source_type AS sourceType,
           d.parse_notes AS parseNotes, d.created_by AS createdBy, d.created_at AS createdAt, d.approved_at AS approvedAt,
           COUNT(l.id) AS lineCount
    FROM supplier_invoice_drafts d
    LEFT JOIN supplier_invoice_draft_lines l ON l.draft_id = d.id
    GROUP BY d.id
    ORDER BY d.id DESC
  `);
}

function getInvoiceDraft(id) {
  const draft = getOne(`
    SELECT d.id, d.supplier_id AS supplierId, d.supplier_name AS supplierName, d.invoice_number AS invoiceNumber,
           d.invoice_date AS invoiceDate, d.total_amount AS totalAmount, d.status, d.source_type AS sourceType,
           d.raw_text AS rawText, d.parse_notes AS parseNotes, d.created_by AS createdBy, d.created_at AS createdAt, d.approved_at AS approvedAt
    FROM supplier_invoice_drafts d
    WHERE d.id=?
  `, [id]);
  if (!draft.id) {
    return null;
  }
  draft.lines = getAll(`
    SELECT id, line_no AS lineNo, raw_description AS rawDescription, qty, unit_price AS unitPrice,
           line_total AS lineTotal, matched_item_id AS matchedItemId, matched_barcode AS matchedBarcode,
           matched_item_name AS matchedItemName, match_confidence AS matchConfidence, review_status AS reviewStatus
    FROM supplier_invoice_draft_lines
    WHERE draft_id=?
    ORDER BY line_no, id
  `, [id]);
  return draft;
}

function createOrderNumber() {
  return `ORD-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${Math.floor(Math.random() * 900 + 100)}`;
}

function getOnlineOrders() {
  return getAll(`
    SELECT o.id, o.order_number AS orderNumber, o.customer_name AS customerName, o.customer_phone AS customerPhone,
           o.customer_email AS customerEmail, o.notes, o.status, o.total_amount AS totalAmount,
           o.created_at AS createdAt, o.updated_at AS updatedAt, o.collected_at AS collectedAt,
           o.payment_provider AS paymentProvider, o.payment_status AS paymentStatus,
           o.payment_reference AS paymentReference, o.payfast_payment_id AS payfastPaymentId, o.paid_at AS paidAt,
           COUNT(l.id) AS lineCount
    FROM online_orders o
    LEFT JOIN online_order_lines l ON l.order_id = o.id
    GROUP BY o.id
    ORDER BY o.id DESC
  `);
}

function getOnlineOrder(idOrNumber) {
  const isId = Number.isInteger(idOrNumber) || /^\d+$/.test(String(idOrNumber));
  const order = isId
    ? getOne(`
        SELECT id, order_number AS orderNumber, customer_name AS customerName, customer_phone AS customerPhone,
               customer_email AS customerEmail, notes, status, total_amount AS totalAmount,
               created_at AS createdAt, updated_at AS updatedAt, collected_at AS collectedAt,
               payment_provider AS paymentProvider, payment_status AS paymentStatus,
               payment_reference AS paymentReference, payfast_payment_id AS payfastPaymentId, paid_at AS paidAt
        FROM online_orders
        WHERE id=?
      `, [Number(idOrNumber)])
    : getOne(`
        SELECT id, order_number AS orderNumber, customer_name AS customerName, customer_phone AS customerPhone,
               customer_email AS customerEmail, notes, status, total_amount AS totalAmount,
               created_at AS createdAt, updated_at AS updatedAt, collected_at AS collectedAt,
               payment_provider AS paymentProvider, payment_status AS paymentStatus,
               payment_reference AS paymentReference, payfast_payment_id AS payfastPaymentId, paid_at AS paidAt
        FROM online_orders
        WHERE order_number=?
      `, [String(idOrNumber)]);
  if (!order.id) {
    return null;
  }
  order.lines = getAll(`
    SELECT id, item_id AS itemId, barcode, item_name AS itemName, qty, unit_price AS unitPrice, line_total AS lineTotal
    FROM online_order_lines
    WHERE order_id=?
    ORDER BY id
  `, [order.id]);
  return order;
}

function getDbOne(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  try {
    if (stmt.step()) {
      return stmt.getAsObject();
    }
    return {};
  } finally {
    stmt.free();
  }
}

function recordOnlineOrderSale(db, order, payfastPaymentId = "") {
  if (!order?.id || String(order.paymentStatus || "").toUpperCase() !== "PAID") {
    return null;
  }
  const existing = getDbOne(db, "SELECT id FROM sales WHERE receipt_no=?", [order.orderNumber]);
  if (existing.id) {
    return existing.id;
  }

  const itemCount = (order.lines || []).reduce((sum, line) => sum + asInteger(line.qty, 0), 0);
  db.run(
    `INSERT INTO sales
     (receipt_no, total_amount, item_count, created_at, sale_type, status, cashier_id, cashier_name,
      customer_id, customer_name, reference_sale_id, notes, shift_id, payment_method,
      cash_amount, card_amount, eft_amount, card_charge_amount, discount_code, discount_name, discount_amount)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'SALE', 'COMPLETED', NULL, 'Online Store',
      NULL, ?, NULL, ?, NULL, 'PAYFAST', 0, 0, ?, 0, '', '', 0)`,
    [
      order.orderNumber,
      asNumber(order.totalAmount, 0),
      itemCount,
      order.customerName || "Online Customer",
      `Paid online order ${order.orderNumber}${payfastPaymentId ? ` via PayFast ${payfastPaymentId}` : ""}`,
      asNumber(order.totalAmount, 0),
    ],
  );
  const saleId = db.exec("SELECT last_insert_rowid() AS id")?.[0]?.values?.[0]?.[0] ?? null;

  for (const line of order.lines || []) {
    db.run(
      `INSERT INTO sale_lines
       (sale_id, item_id, barcode, item_name, qty, unit_price, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [saleId, line.itemId, line.barcode, line.itemName, line.qty, line.unitPrice, line.lineTotal],
    );

    const item = getDbOne(db, "SELECT stock_qty FROM items WHERE id=?", [line.itemId]);
    const currentStock = asNumber(item.stock_qty, 0);
    db.run(
      `INSERT INTO stock_movements
       (item_id, barcode, item_name, movement_type, qty_change, stock_before, stock_after, reference_no, notes)
       VALUES (?, ?, ?, 'ONLINE_PAID', 0, ?, ?, ?, ?)`,
      [
        line.itemId,
        line.barcode,
        line.itemName,
        currentStock,
        currentStock,
        order.orderNumber,
        `Payment confirmed for online order ${order.orderNumber}`,
      ],
    );
  }

  return saleId;
}

function reconcilePaidOnlineOrderSales() {
  const rows = getAll("SELECT order_number AS orderNumber FROM online_orders WHERE payment_status='PAID' ORDER BY id");
  for (const row of rows) {
    const order = getOnlineOrder(row.orderNumber);
    if (!order) {
      continue;
    }
    writeDatabase((db) => {
      recordOnlineOrderSale(db, order, order.payfastPaymentId || "");
    });
  }
}

function publicStoreCustomer(row) {
  return {
    id: Number(row.id),
    fullName: String(row.full_name ?? row.fullName ?? ""),
    phone: String(row.phone ?? ""),
    email: String(row.email ?? "").toLowerCase(),
  };
}

setInterval(cleanupSessions, 60 * 60 * 1000).unref();

app.get("/", (_req, res) => {
  res.json({
    name: "Simple POS API",
    status: "running",
    routes: ["/health", "/auth/login", "/auth/me"],
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, dbPath: DB_PATH });
});

app.get("/store/products", (_req, res) => {
  res.json(getAll(`
    SELECT i.id, i.barcode, i.name, i.category, i.description, i.price, i.stock_qty AS stock,
           i.image_url AS imageUrl,
           COALESCE(s.name, '') AS supplier
    FROM items i
    LEFT JOIN suppliers s ON s.id = i.preferred_supplier_id
    WHERE i.is_active=1 AND i.stock_qty > 0
    ORDER BY i.name
  `));
});

app.get("/store/business-profile", (_req, res) => {
  res.json(getBusinessProfile());
});

app.post("/store/auth/register", (req, res) => {
  const fullName = String(req.body?.fullName ?? "").trim();
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: "Full name, email, and password are required." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }
  const existing = getOne("SELECT id FROM online_customers WHERE lower(email)=lower(?)", [email]);
  if (existing.id) {
    return res.status(409).json({ error: "An online account with that email already exists." });
  }
  let createdId = null;
  writeDatabase((db) => {
    db.run(
      `INSERT INTO online_customers
       (full_name, phone, email, password_hash, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [fullName, "", email, hashSecret(password)],
    );
    const row = db.exec("SELECT last_insert_rowid() AS id");
    createdId = row?.[0]?.values?.[0]?.[0] ?? null;
  });
  const customer = getOne("SELECT id, full_name, phone, email FROM online_customers WHERE id=?", [createdId]);
  const safeCustomer = publicStoreCustomer(customer);
  const token = createSession(safeCustomer, "store-customer");
  return res.status(201).json({ token, customer: safeCustomer });
});

app.post("/store/auth/login", (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  const customer = getOne(
    `SELECT id, full_name, phone, email, password_hash, is_active
     FROM online_customers
     WHERE lower(email)=lower(?)`,
    [email],
  );
  if (!customer.id || Number(customer.is_active) !== 1 || !verifySecret(password, customer.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  const safeCustomer = publicStoreCustomer(customer);
  const token = createSession(safeCustomer, "store-customer");
  return res.json({ token, customer: safeCustomer, trial: publicTrial(res.locals.trial || getTrialStatus()) });
});

app.get("/store/auth/me", storeCustomerAuthRequired, (req, res) => {
  res.json({ customer: req.storeCustomer });
});

app.post("/store/auth/logout", storeCustomerAuthRequired, (req, res) => {
  const token = authTokenFromRequest(req);
  sessions.delete(token);
  res.json({ ok: true });
});

app.get("/store/account/orders", storeCustomerAuthRequired, (req, res) => {
  const rows = getAll(
    `SELECT id, order_number AS orderNumber, customer_name AS customerName, customer_phone AS customerPhone,
            customer_email AS customerEmail, notes, status, total_amount AS totalAmount,
            created_at AS createdAt, updated_at AS updatedAt, collected_at AS collectedAt,
            payment_provider AS paymentProvider, payment_status AS paymentStatus,
            payment_reference AS paymentReference, payfast_payment_id AS payfastPaymentId, paid_at AS paidAt
     FROM online_orders
     WHERE online_customer_id=?
     ORDER BY id DESC`,
    [req.storeCustomer.id],
  ).map((row) => ({
    ...row,
    lines: getAll(
      `SELECT id, item_id AS itemId, barcode, item_name AS itemName, qty, unit_price AS unitPrice, line_total AS lineTotal
       FROM online_order_lines
       WHERE order_id=?
       ORDER BY id`,
      [row.id],
    ),
  }));
  res.json(rows);
});

app.get("/store/orders/:orderNumber", (req, res) => {
  const orderNumber = String(req.params.orderNumber ?? "").trim();
  if (!orderNumber) {
    return res.status(400).json({ error: "Order number is required." });
  }
  const order = getOnlineOrder(orderNumber);
  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }
  return res.json(order);
});

app.post("/store/orders/:orderNumber/payfast", (req, res) => {
  if (!PAYFAST_MERCHANT_ID || !PAYFAST_MERCHANT_KEY) {
    return res.status(503).json({
      error: "PayFast sandbox credentials are not configured.",
      required: ["PAYFAST_MERCHANT_ID", "PAYFAST_MERCHANT_KEY"],
    });
  }
  const orderNumber = String(req.params.orderNumber ?? "").trim();
  const order = getOnlineOrder(orderNumber);
  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }
  if (String(order.status).toUpperCase() === "CANCELLED") {
    return res.status(400).json({ error: "Cancelled orders cannot be paid." });
  }

  return res.json(createPayFastCheckout(order));
});

app.get("/store/orders/:orderNumber/payfast/redirect", (req, res) => {
  if (!PAYFAST_MERCHANT_ID || !PAYFAST_MERCHANT_KEY) {
    return res.status(503).send("PayFast sandbox credentials are not configured.");
  }
  const orderNumber = String(req.params.orderNumber ?? "").trim();
  const order = getOnlineOrder(orderNumber);
  if (!order) {
    return res.status(404).send("Order not found.");
  }
  if (String(order.status).toUpperCase() === "CANCELLED") {
    return res.status(400).send("Cancelled orders cannot be paid.");
  }
  return res.type("html").send(renderPayFastAutoSubmit(createPayFastCheckout(order)));
});

app.post("/store/payfast/itn", (req, res) => {
  const payload = req.body || {};
  const receivedSignature = String(payload.signature || "").trim();
  const expectedSignature = payFastSignature(payload);
  if ((PAYFAST_PASSPHRASE || PAYFAST_REQUIRE_SIGNATURE) && (!receivedSignature || receivedSignature !== expectedSignature)) {
    return res.status(400).send("Invalid PayFast signature");
  }

  const paymentReference = String(payload.m_payment_id || "").trim();
  const orderNumber = String(payload.custom_str1 || paymentReference.replace(/^PF-/, "")).trim();
  const order = getOnlineOrder(orderNumber);
  if (!order) {
    return res.status(404).send("Order not found");
  }

  const paidAmount = Number(payload.amount_gross || payload.amount || 0);
  const expectedAmount = Number(order.totalAmount || 0);
  if (Math.abs(paidAmount - expectedAmount) > 0.01) {
    return res.status(400).send("PayFast amount mismatch");
  }

  const paymentStatus = String(payload.payment_status || "").toUpperCase();
  const nextStatus = paymentStatus === "COMPLETE" ? "PAID" : paymentStatus || "RECEIVED";
  writeDatabase((db) => {
    db.run(
      `UPDATE online_orders
       SET payment_provider='PAYFAST',
           payment_status=?,
           payment_reference=?,
           payfast_payment_id=?,
           paid_at=CASE WHEN ?='PAID' THEN CURRENT_TIMESTAMP ELSE paid_at END,
           updated_at=CURRENT_TIMESTAMP
       WHERE order_number=?`,
      [nextStatus, paymentReference, String(payload.pf_payment_id || ""), nextStatus, order.orderNumber],
    );
    if (nextStatus === "PAID") {
      recordOnlineOrderSale(db, { ...order, paymentStatus: "PAID" }, String(payload.pf_payment_id || ""));
    }
  });

  return res.status(200).send("OK");
});

app.post("/store/orders", optionalStoreCustomer, (req, res) => {
  const customerName = req.storeCustomer?.fullName ?? String(req.body?.customerName ?? "").trim();
  const customerPhone = String(req.body?.customerPhone ?? req.storeCustomer?.phone ?? "").trim();
  const customerEmail = req.storeCustomer?.email ?? String(req.body?.customerEmail ?? "").trim().toLowerCase();
  const notes = String(req.body?.notes ?? "").trim();
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];

  if (!customerName || !customerPhone) {
    return res.status(400).json({ error: "Customer name and phone are required." });
  }
  if (!lines.length) {
    return res.status(400).json({ error: "Add at least one item to the order." });
  }

  const normalizedLines = lines.map((line) => ({
    itemId: asInteger(line.itemId, 0),
    qty: asInteger(line.qty, 0),
  }));
  if (normalizedLines.some((line) => !line.itemId || line.qty <= 0)) {
    return res.status(400).json({ error: "Order lines must include a valid item and quantity." });
  }

  const orderNumber = createOrderNumber();
  let createdId = null;
  try {
    writeDatabase((db) => {
      let totalAmount = 0;
      const preparedLines = [];

      for (const line of normalizedLines) {
        const stmt = db.prepare("SELECT id, barcode, name, price, stock_qty, is_active FROM items WHERE id=?");
        stmt.bind([line.itemId]);
        let item = null;
        if (stmt.step()) {
          item = stmt.getAsObject();
        }
        stmt.free();
        if (!item?.id || Number(item.is_active) !== 1) {
          throw new Error("One of the selected products is no longer available.");
        }
        if (line.qty > asInteger(item.stock_qty, 0)) {
          throw new Error(`${item.name} does not have enough stock for this order.`);
        }
        const after = asInteger(item.stock_qty, 0) - line.qty;
        db.run("UPDATE items SET stock_qty=? WHERE id=?", [after, item.id]);
        db.run(
          `INSERT INTO stock_movements
           (item_id, barcode, item_name, movement_type, qty_change, stock_before, stock_after, reference_no, notes)
           VALUES (?, ?, ?, 'ONLINE_RESERVE', ?, ?, ?, ?, ?)`,
          [item.id, item.barcode, item.name, -line.qty, item.stock_qty, after, orderNumber, `Reserved for online order ${orderNumber}`],
        );
        const unitPrice = asNumber(item.price, 0);
        const lineTotal = unitPrice * line.qty;
        totalAmount += lineTotal;
        preparedLines.push({
          itemId: item.id,
          barcode: item.barcode,
          itemName: item.name,
          qty: line.qty,
          unitPrice,
          lineTotal,
        });
      }

      db.run(
        `INSERT INTO online_orders
         (online_customer_id, order_number, customer_name, customer_phone, customer_email, notes, status, total_amount, created_at, updated_at, reserved_at)
         VALUES (?, ?, ?, ?, ?, ?, 'READY_FOR_COLLECTION', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [req.storeCustomer?.id ?? null, orderNumber, customerName, customerPhone, customerEmail, notes, totalAmount],
      );
      const row = db.exec("SELECT last_insert_rowid() AS id");
      createdId = row?.[0]?.values?.[0]?.[0] ?? null;
      for (const line of preparedLines) {
        db.run(
          `INSERT INTO online_order_lines
           (order_id, item_id, barcode, item_name, qty, unit_price, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [createdId, line.itemId, line.barcode, line.itemName, line.qty, line.unitPrice, line.lineTotal],
        );
      }
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Could not create order." });
  }

  return res.status(201).json({ ok: true, order: getOnlineOrder(createdId) });
});

app.post("/auth/login", (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const pin = String(req.body?.pin ?? "").trim();
  if (!username || !pin) {
    return res.status(400).json({ error: "Username and PIN are required." });
  }

  const user = getOne(
    `SELECT id, username, display_name, pin, is_active, web_permissions
     FROM cashiers
     WHERE lower(username)=lower(?) AND pin=? AND is_active=1`,
    [username, pin],
  );

  if (!user.id) {
    return res.status(401).json({ error: "Invalid username or PIN." });
  }

  const safeUser = publicUser(user);
  const token = createSession(safeUser);
  return res.json({ token, user: safeUser, trial: publicTrial(res.locals.trial || getTrialStatus()) });
});

app.post("/auth/admin-pin", (req, res) => {
  const pin = String(req.body?.pin ?? "").trim();
  const confirmPin = String(req.body?.confirmPin ?? "").trim();

  if (!pin || !confirmPin) {
    return res.status(400).json({ error: "New admin PIN and confirmation are required." });
  }

  if (pin !== confirmPin) {
    return res.status(400).json({ error: "The admin PIN confirmation does not match." });
  }

  if (!/^\d{4,8}$/.test(pin)) {
    return res.status(400).json({ error: "Admin PIN must be 4 to 8 digits." });
  }

  writeDatabase((db) => {
    const stmt = db.prepare("SELECT id, display_name FROM cashiers WHERE lower(username)=lower('admin')");
    let admin = null;
    if (stmt.step()) {
      admin = stmt.getAsObject();
    }
    stmt.free();

    if (admin?.id) {
      db.run(
        "UPDATE cashiers SET pin=?, display_name=?, is_active=1, web_permissions=? WHERE id=?",
        [pin, admin.display_name || "Administrator", JSON.stringify(ALL_PERMISSIONS), admin.id],
      );
    } else {
      db.run(
        "INSERT INTO cashiers (username, display_name, pin, is_active, web_permissions) VALUES ('admin', 'Administrator', ?, 1, ?)",
        [pin, JSON.stringify(ALL_PERMISSIONS)],
      );
    }
  });

  expireAdminSessions();
  return res.json({ ok: true, message: "Admin PIN updated." });
});

app.get("/auth/me", authRequired, (req, res) => {
  res.json({ user: req.user, trial: publicTrial(res.locals.trial || getTrialStatus()) });
});

app.post("/auth/logout", authRequired, (req, res) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  sessions.delete(token);
  res.json({ ok: true });
});

app.get("/business-profile", authRequired, (_req, res) => {
  res.json({
    profile: getBusinessProfile(),
    templates: Object.entries(BUSINESS_TEMPLATES).map(([key, value]) => ({
      key,
      label: value.label,
      settings: value.settings,
    })),
  });
});

app.put("/business-profile", authRequired, adminRequired, (req, res) => {
  const businessName = String(req.body?.businessName ?? "").trim();
  const businessAddress = String(req.body?.businessAddress ?? "").trim();
  const businessPhone = String(req.body?.businessPhone ?? "").trim();
  const cardChargeAmount = Math.max(0, asNumber(req.body?.cardChargeAmount, 0));
  const cardChargeEnabled = req.body?.cardChargeEnabled === true || req.body?.cardChargeEnabled === 1 || req.body?.cardChargeEnabled === "1";
  if (!businessName) {
    return res.status(400).json({ error: "Business name is required." });
  }
  const current = getBusinessProfile();
  const logoUrl = persistBusinessLogo(req.body?.logoUrl ?? current.logoUrl ?? "");
  writeDatabase((db) => {
    db.run(
      "UPDATE business_profile SET business_name=?, logo_url=?, business_address=?, business_phone=?, card_charge_amount=?, card_charge_enabled=?, applied_at=CURRENT_TIMESTAMP WHERE id=1",
      [businessName, logoUrl, businessAddress, businessPhone, cardChargeAmount, cardChargeEnabled ? 1 : 0],
    );
  });
  res.json({
    ok: true,
    profile: {
      ...current,
      businessName,
      logoUrl,
      businessAddress,
      businessPhone,
      cardChargeAmount,
      cardChargeEnabled,
    },
  });
});

app.post("/business-profile/apply", authRequired, adminRequired, (req, res) => {
  const templateKey = String(req.body?.templateKey ?? "").trim().toLowerCase();
  const template = BUSINESS_TEMPLATES[templateKey];
  if (!template) {
    return res.status(400).json({ error: "Unknown business template." });
  }

  const current = getBusinessProfile();
  writeDatabase((db) => {
    db.run("DELETE FROM sale_lines");
    db.run("DELETE FROM sales");
    db.run("DELETE FROM stock_movements");
    db.run("DELETE FROM shifts");
    db.run("DELETE FROM day_end_cashups");
    db.run("DELETE FROM purchase_orders");
    db.run("DELETE FROM items");
    db.run("DELETE FROM customers");
    db.run("DELETE FROM suppliers");
    db.run("DELETE FROM customer_payments");
    db.run("DELETE FROM discounts");
    template.items.forEach((item) => {
      db.run("INSERT INTO items (barcode, name, price, stock_qty, category, description, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)", item);
    });
    template.customers.forEach((customer) => {
      db.run("INSERT INTO customers (customer_code, name, phone, credit_limit, balance, is_active) VALUES (?, ?, ?, ?, ?, 1)", customer);
    });
    template.suppliers.forEach((supplier) => {
      db.run("INSERT INTO suppliers (supplier_code, name, phone, email, contact_person, is_active) VALUES (?, ?, ?, ?, ?, 1)", supplier);
    });
    db.run("INSERT OR REPLACE INTO business_profile (id, business_type, business_name, settings_json, applied_at, logo_url, business_address, business_phone, card_charge_amount, card_charge_enabled) VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)", [
      templateKey,
      current.businessName || template.label,
      JSON.stringify(template.settings),
      current.logoUrl || "",
      current.businessAddress || "",
      current.businessPhone || "",
      current.cardChargeAmount || 0,
      current.cardChargeEnabled ? 1 : 0,
    ]);
  });

  res.json({ ok: true, profile: getBusinessProfile() });
});

app.get("/users", authRequired, adminRequired, (_req, res) => {
  res.json(listUsers());
});

app.post("/users", authRequired, adminRequired, (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const displayName = String(req.body?.displayName ?? "").trim();
  const pin = String(req.body?.pin ?? "").trim();
  const isActive = req.body?.isActive === false ? 0 : 1;
  const permissions = normalizePermissions(req.body?.permissions, username);

  if (!username || !displayName || !pin) {
    return res.status(400).json({ error: "Username, display name, and PIN are required." });
  }

  if (!/^\d{4,8}$/.test(pin)) {
    return res.status(400).json({ error: "PIN must be 4 to 8 digits." });
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return res.status(400).json({ error: "Username may only contain letters, numbers, dot, dash, or underscore." });
  }

  const existing = getOne("SELECT id FROM cashiers WHERE lower(username)=lower(?)", [username]);
  if (existing.id) {
    return res.status(409).json({ error: "That username already exists." });
  }

  writeDatabase((db) => {
    db.run(
      "INSERT INTO cashiers (username, display_name, pin, is_active, web_permissions) VALUES (?, ?, ?, ?, ?)",
      [username, displayName, pin, isActive, JSON.stringify(permissions)],
    );
  });

  return res.status(201).json({ ok: true, users: listUsers() });
});

app.put("/users/:id", authRequired, adminRequired, (req, res) => {
  const id = Number(req.params.id);
  const displayName = String(req.body?.displayName ?? "").trim();
  const pin = String(req.body?.pin ?? "").trim();
  const isActive = req.body?.isActive === false ? 0 : 1;
  const usernameFromBody = String(req.body?.username ?? "").trim();

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  const existing = getOne("SELECT id, username, display_name, web_permissions FROM cashiers WHERE id=?", [id]);
  if (!existing.id) {
    return res.status(404).json({ error: "User not found." });
  }

  if (existing.username === "admin" && isActive === 0) {
    return res.status(400).json({ error: "The main admin account cannot be disabled." });
  }

  if (pin && !/^\d{4,8}$/.test(pin)) {
    return res.status(400).json({ error: "PIN must be 4 to 8 digits." });
  }

  const permissions = normalizePermissions(req.body?.permissions, usernameFromBody || existing.username);

  writeDatabase((db) => {
    if (pin) {
      db.run(
        "UPDATE cashiers SET display_name=?, pin=?, is_active=?, web_permissions=? WHERE id=?",
        [displayName || existing.display_name, pin, isActive, JSON.stringify(permissions), id],
      );
    } else {
      db.run(
        "UPDATE cashiers SET display_name=?, is_active=?, web_permissions=? WHERE id=?",
        [displayName || existing.display_name, isActive, JSON.stringify(permissions), id],
      );
    }
  });

  return res.json({ ok: true, users: listUsers() });
});

app.get("/dashboard", authRequired, permissionAnyRequired("dashboard", "cashups"), (_req, res) => {
  const totals = getOne(`
    SELECT
      COALESCE(SUM(CASE WHEN sale_type='SALE' AND status='COMPLETED' THEN total_amount ELSE 0 END),0) AS totalSales,
      COALESCE(SUM(CASE WHEN sale_type='RETURN' AND status='COMPLETED' THEN ABS(total_amount) ELSE 0 END),0) AS totalReturns,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN total_amount ELSE 0 END),0) AS netTotal,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN cash_amount ELSE 0 END),0) AS cash,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN card_amount ELSE 0 END),0) AS card,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN eft_amount ELSE 0 END),0) AS eft,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN card_charge_amount ELSE 0 END),0) AS cardCharges,
      COALESCE((
        SELECT SUM(COALESCE(sl.qty, 0) * COALESCE(i.cost_price, 0))
        FROM sale_lines sl
        INNER JOIN sales s2 ON s2.id = sl.sale_id
        LEFT JOIN items i ON i.id = sl.item_id
        WHERE s2.status='COMPLETED' AND s2.sale_type='SALE'
      ),0) AS costOfGoodsSold
    FROM sales
  `);
  totals.creditSalesOut = Number(getOne(`
    SELECT COALESCE(SUM(debit_amount),0) AS amount
    FROM customer_account_entries
    WHERE entry_type='CREDIT_SALE'
  `).amount || 0);
  totals.customerPaymentsIn = Number(getOne(`
    SELECT COALESCE(SUM(credit_amount),0) AS amount
    FROM customer_account_entries
    WHERE entry_type='PAYMENT'
  `).amount || 0);
  totals.realizedRevenue = totals.customerPaymentsIn - totals.creditSalesOut;
  totals.grossProfit = totals.realizedRevenue;

  const lowStock = getAll(`
    SELECT i.id, i.barcode, i.name, i.stock_qty AS stock, i.reorder_level AS reorderLevel,
           COALESCE(s.name, '') AS supplier, i.category, i.price, i.cost_price AS costPrice
    FROM items i
    LEFT JOIN suppliers s ON s.id = i.preferred_supplier_id
    WHERE i.stock_qty <= i.reorder_level
    ORDER BY i.stock_qty ASC, i.name
  `);

  const cashierSummary = getAll(`
    SELECT
      COALESCE(cashier_name, 'Unknown') AS cashier,
      COALESCE(SUM(CASE WHEN sale_type='SALE' AND status='COMPLETED' THEN total_amount ELSE 0 END),0) AS sales,
      COALESCE(SUM(CASE WHEN sale_type='RETURN' AND status='COMPLETED' THEN ABS(total_amount) ELSE 0 END),0) AS returns,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN total_amount ELSE 0 END),0) AS net,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN cash_amount ELSE 0 END),0) AS cash,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN card_amount ELSE 0 END),0) AS card,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN eft_amount ELSE 0 END),0) AS eft,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN card_charge_amount ELSE 0 END),0) AS cardCharges,
      COALESCE((
        SELECT SUM(COALESCE(sl.qty, 0) * COALESCE(i.cost_price, 0))
        FROM sale_lines sl
        INNER JOIN sales s2 ON s2.id = sl.sale_id
        LEFT JOIN items i ON i.id = sl.item_id
        WHERE s2.status='COMPLETED'
          AND s2.sale_type='SALE'
          AND COALESCE(s2.cashier_name, 'Unknown') = COALESCE(s.cashier_name, 'Unknown')
      ),0) AS costOfGoodsSold
    FROM sales s
    GROUP BY COALESCE(s.cashier_name, 'Unknown')
    ORDER BY cashier
  `).map((row) => ({
    ...row,
    creditSalesOut: Number(getOne(`
      SELECT COALESCE(SUM(cae.debit_amount),0) AS amount
      FROM customer_account_entries cae
      INNER JOIN sales s ON s.id = cae.sale_id
      WHERE cae.entry_type='CREDIT_SALE'
        AND COALESCE(s.cashier_name, 'Unknown')=?
    `, [row.cashier]).amount || 0),
    customerPaymentsIn: Number(getOne(`
      SELECT COALESCE(SUM(credit_amount),0) AS amount
      FROM customer_account_entries
      WHERE entry_type='PAYMENT'
        AND COALESCE(description, '') IS NOT NULL
        AND id IN (
          SELECT cae2.id
          FROM customer_account_entries cae2
          LEFT JOIN customer_payments cp ON cp.id = cae2.payment_id
          WHERE cae2.entry_type='PAYMENT'
            AND COALESCE(cp.cashier_name, 'Unknown')=?
        )
    `, [row.cashier]).amount || 0),
    grossProfit: Number(row.sales || 0) - Number(row.costOfGoodsSold || 0),
  })).map((row) => ({
    ...row,
    realizedRevenue: Number(row.customerPaymentsIn || 0) - Number(row.creditSalesOut || 0),
    grossProfit: Number(row.customerPaymentsIn || 0) - Number(row.creditSalesOut || 0),
  }));

  const shifts = getAll(`
    SELECT id, cashier_name AS cashier, started_at AS startedAt, ended_at AS endedAt,
           net_total AS netTotal, expected_cash AS expectedCash, counted_cash AS countedCash,
           cash_difference AS cashDifference
    FROM shifts
    ORDER BY id DESC
    LIMIT 50
  `);

  res.json({ totals, lowStock, cashierSummary, shifts });
});

app.get("/products", authRequired, permissionRequired("products"), (_req, res) => {
  res.json(getAll(`
    SELECT i.id, i.barcode, i.name, i.category, i.description, i.price, i.cost_price AS costPrice,
           i.stock_qty AS stock, i.reorder_level AS reorderLevel, i.is_active AS isActive, i.image_url AS imageUrl,
           COALESCE(s.name, '') AS supplier, i.preferred_supplier_id AS supplierId
    FROM items i
    LEFT JOIN suppliers s ON s.id = i.preferred_supplier_id
    ORDER BY i.name
  `));
});

app.post("/products", authRequired, permissionRequired("products"), (req, res) => {
  const barcode = String(req.body?.barcode ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  const category = String(req.body?.category ?? "").trim();
  const description = String(req.body?.description ?? "").trim();
  const imageUrl = String(req.body?.imageUrl ?? "").trim();
  const price = asNumber(req.body?.price, 0);
  const costPrice = asNumber(req.body?.costPrice, 0);
  const stock = asInteger(req.body?.stock, 0);
  const reorderLevel = asInteger(req.body?.reorderLevel, 0);
  const supplierId = req.body?.supplierId ? asInteger(req.body?.supplierId, 0) : null;
  const isActive = req.body?.isActive === false ? 0 : 1;

  if (!barcode || !name) {
    return res.status(400).json({ error: "Barcode and item name are required." });
  }

  const existing = getOne("SELECT id FROM items WHERE barcode=?", [barcode]);
  if (existing.id) {
    return res.status(409).json({ error: "That barcode already exists." });
  }

  const created = writeDatabase((db) => {
    db.run(
      `INSERT INTO items
       (barcode, name, price, stock_qty, category, description, reorder_level, preferred_supplier_id, cost_price, is_active, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [barcode, name, price, stock, category, description, reorderLevel, supplierId, costPrice, isActive, imageUrl],
    );
    const row = db.exec("SELECT last_insert_rowid() AS id");
    const createdId = row?.[0]?.values?.[0]?.[0] ?? null;
    if (stock !== 0 && createdId) {
      db.run(
        `INSERT INTO stock_movements
         (item_id, barcode, item_name, movement_type, qty_change, stock_before, stock_after, reference_no, notes)
         VALUES (?, ?, ?, 'CREATE', ?, 0, ?, 'WEB-CREATE', 'Created from web admin')`,
        [createdId, barcode, name, stock, stock],
      );
    }
    return { id: createdId };
  });

  return res.status(201).json({ ok: true, id: created?.id });
});

app.put("/products/:id", authRequired, permissionRequired("products"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  const barcode = String(req.body?.barcode ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  const category = String(req.body?.category ?? "").trim();
  const description = String(req.body?.description ?? "").trim();
  const imageUrl = String(req.body?.imageUrl ?? "").trim();
  const price = asNumber(req.body?.price, 0);
  const costPrice = asNumber(req.body?.costPrice, 0);
  const stock = asInteger(req.body?.stock, 0);
  const reorderLevel = asInteger(req.body?.reorderLevel, 0);
  const supplierId = req.body?.supplierId ? asInteger(req.body?.supplierId, 0) : null;
  const isActive = req.body?.isActive === false ? 0 : 1;

  if (!id || !barcode || !name) {
    return res.status(400).json({ error: "Item id, barcode, and item name are required." });
  }

  const existing = getOne("SELECT * FROM items WHERE id=?", [id]);
  if (!existing.id) {
    return res.status(404).json({ error: "Item not found." });
  }

  const barcodeOwner = getOne("SELECT id FROM items WHERE barcode=? AND id<>?", [barcode, id]);
  if (barcodeOwner.id) {
    return res.status(409).json({ error: "That barcode already belongs to another item." });
  }

  writeDatabase((db) => {
    db.run(
      `UPDATE items
       SET barcode=?, name=?, price=?, stock_qty=?, category=?, description=?, reorder_level=?, preferred_supplier_id=?, cost_price=?, is_active=?, image_url=?
       WHERE id=?`,
      [barcode, name, price, stock, category, description, reorderLevel, supplierId, costPrice, isActive, imageUrl, id],
    );

    const previousStock = asNumber(existing.stock_qty, 0);
    const stockChange = stock - previousStock;
    if (stockChange !== 0) {
      db.run(
        `INSERT INTO stock_movements
         (item_id, barcode, item_name, movement_type, qty_change, stock_before, stock_after, reference_no, notes)
         VALUES (?, ?, ?, 'ADJUST', ?, ?, ?, 'WEB-ADJUST', 'Adjusted from web admin')`,
        [id, barcode, name, stockChange, previousStock, stock],
      );
    }
  });

  return res.json({ ok: true });
});

app.post("/products/:id/archive", authRequired, permissionRequired("products"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid product id." });
  }

  const existing = getOne("SELECT id, name FROM items WHERE id=?", [id]);
  if (!existing.id) {
    return res.status(404).json({ error: "Product not found." });
  }

  writeDatabase((db) => {
    db.run("UPDATE items SET is_active=0 WHERE id=?", [id]);
  });

  return res.json({ ok: true, message: `${existing.name} archived.` });
});

app.post("/products/:id/restore", authRequired, permissionRequired("products"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid product id." });
  }

  writeDatabase((db) => {
    db.run("UPDATE items SET is_active=1 WHERE id=?", [id]);
  });

  return res.json({ ok: true });
});

app.delete("/products/:id", authRequired, permissionRequired("products"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid product id." });
  }

  const existing = getOne("SELECT id, name FROM items WHERE id=?", [id]);
  if (!existing.id) {
    return res.status(404).json({ error: "Product not found." });
  }

  writeDatabase((db) => {
    db.run("DELETE FROM items WHERE id=?", [id]);
  });

  return res.json({ ok: true, message: `${existing.name} deleted.` });
});

app.get("/suppliers", authRequired, permissionRequired("suppliers"), (_req, res) => {
  res.json(getAll(`
    SELECT id, supplier_code AS code, name, phone, email, contact_person AS contact, is_active AS isActive
    FROM suppliers
    ORDER BY name
  `));
});

app.post("/suppliers", authRequired, permissionRequired("suppliers"), (req, res) => {
  const code = String(req.body?.code ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  const phone = String(req.body?.phone ?? "").trim();
  const email = String(req.body?.email ?? "").trim();
  const contact = String(req.body?.contact ?? "").trim();
  const isActive = req.body?.isActive === false ? 0 : 1;

  if (!code || !name) {
    return res.status(400).json({ error: "Supplier code and name are required." });
  }

  const existing = getOne("SELECT id FROM suppliers WHERE supplier_code=?", [code]);
  if (existing.id) {
    return res.status(409).json({ error: "That supplier code already exists." });
  }

  writeDatabase((db) => {
    db.run(
      "INSERT INTO suppliers (supplier_code, name, phone, email, contact_person, is_active) VALUES (?, ?, ?, ?, ?, ?)",
      [code, name, phone, email, contact, isActive],
    );
  });

  return res.status(201).json({ ok: true });
});

app.put("/suppliers/:id", authRequired, permissionRequired("suppliers"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  const code = String(req.body?.code ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  const phone = String(req.body?.phone ?? "").trim();
  const email = String(req.body?.email ?? "").trim();
  const contact = String(req.body?.contact ?? "").trim();
  const isActive = req.body?.isActive === false ? 0 : 1;

  if (!id || !code || !name) {
    return res.status(400).json({ error: "Supplier id, code, and name are required." });
  }

  const existing = getOne("SELECT id FROM suppliers WHERE id=?", [id]);
  if (!existing.id) {
    return res.status(404).json({ error: "Supplier not found." });
  }

  const codeOwner = getOne("SELECT id FROM suppliers WHERE supplier_code=? AND id<>?", [code, id]);
  if (codeOwner.id) {
    return res.status(409).json({ error: "That supplier code already belongs to another supplier." });
  }

  writeDatabase((db) => {
    db.run(
      "UPDATE suppliers SET supplier_code=?, name=?, phone=?, email=?, contact_person=?, is_active=? WHERE id=?",
      [code, name, phone, email, contact, isActive, id],
    );
  });

  return res.json({ ok: true });
});

app.post("/suppliers/:id/archive", authRequired, permissionRequired("suppliers"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid supplier id." });
  }
  writeDatabase((db) => {
    db.run("UPDATE suppliers SET is_active=0 WHERE id=?", [id]);
  });
  return res.json({ ok: true });
});

app.post("/suppliers/:id/restore", authRequired, permissionRequired("suppliers"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid supplier id." });
  }
  writeDatabase((db) => {
    db.run("UPDATE suppliers SET is_active=1 WHERE id=?", [id]);
  });
  return res.json({ ok: true });
});

app.delete("/suppliers/:id", authRequired, permissionRequired("suppliers"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid supplier id." });
  }

  const existing = getOne("SELECT id, name FROM suppliers WHERE id=?", [id]);
  if (!existing.id) {
    return res.status(404).json({ error: "Supplier not found." });
  }

  writeDatabase((db) => {
    db.run("UPDATE items SET preferred_supplier_id=NULL WHERE preferred_supplier_id=?", [id]);
    db.run("UPDATE supplier_invoice_drafts SET supplier_id=NULL WHERE supplier_id=?", [id]);
    db.run("UPDATE purchase_orders SET supplier_id=NULL WHERE supplier_id=?", [id]);
    db.run("DELETE FROM suppliers WHERE id=?", [id]);
  });

  return res.json({ ok: true, message: `${existing.name} deleted.` });
});

app.get("/discounts", authRequired, adminRequired, (_req, res) => {
  res.json(getAll(`
    SELECT id, discount_code AS code, name, amount, is_active AS isActive
    FROM discounts
    ORDER BY name
  `));
});

app.post("/discounts", authRequired, adminRequired, (req, res) => {
  const code = String(req.body?.code ?? "").trim().toUpperCase();
  const name = String(req.body?.name ?? "").trim();
  const amount = asNumber(req.body?.amount, 0);
  const isActive = req.body?.isActive === false ? 0 : 1;
  if (!code || !name) {
    return res.status(400).json({ error: "Discount code and name are required." });
  }
  if (amount <= 0) {
    return res.status(400).json({ error: "Discount amount must be greater than zero." });
  }
  const existing = getOne("SELECT id FROM discounts WHERE upper(discount_code)=upper(?)", [code]);
  if (existing.id) {
    return res.status(409).json({ error: "That discount code already exists." });
  }
  writeDatabase((db) => {
    db.run(
      "INSERT INTO discounts (discount_code, name, amount, is_active) VALUES (?, ?, ?, ?)",
      [code, name, amount, isActive],
    );
  });
  return res.status(201).json({ ok: true });
});

app.put("/discounts/:id", authRequired, adminRequired, (req, res) => {
  const id = asInteger(req.params.id, 0);
  const code = String(req.body?.code ?? "").trim().toUpperCase();
  const name = String(req.body?.name ?? "").trim();
  const amount = asNumber(req.body?.amount, 0);
  const isActive = req.body?.isActive === false ? 0 : 1;
  if (!id || !code || !name) {
    return res.status(400).json({ error: "Discount id, code, and name are required." });
  }
  if (amount <= 0) {
    return res.status(400).json({ error: "Discount amount must be greater than zero." });
  }
  const existing = getOne("SELECT id FROM discounts WHERE id=?", [id]);
  if (!existing.id) {
    return res.status(404).json({ error: "Discount not found." });
  }
  const owner = getOne("SELECT id FROM discounts WHERE upper(discount_code)=upper(?) AND id<>?", [code, id]);
  if (owner.id) {
    return res.status(409).json({ error: "That discount code already belongs to another discount." });
  }
  writeDatabase((db) => {
    db.run(
      "UPDATE discounts SET discount_code=?, name=?, amount=?, is_active=? WHERE id=?",
      [code, name, amount, isActive, id],
    );
  });
  return res.json({ ok: true });
});

app.delete("/discounts/:id", authRequired, adminRequired, (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid discount id." });
  }
  const existing = getOne("SELECT id, name FROM discounts WHERE id=?", [id]);
  if (!existing.id) {
    return res.status(404).json({ error: "Discount not found." });
  }
  writeDatabase((db) => {
    db.run("DELETE FROM discounts WHERE id=?", [id]);
  });
  return res.json({ ok: true, message: `${existing.name} deleted.` });
});

app.get("/customers", authRequired, permissionRequired("customers"), (_req, res) => {
  res.json(getCustomersWithOverdue());
});

app.post("/customers", authRequired, permissionRequired("customers"), (req, res) => {
  const code = String(req.body?.code ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  const phone = String(req.body?.phone ?? "").trim();
  const email = String(req.body?.email ?? "").trim();
  const address = String(req.body?.address ?? "").trim();
  const creditLimit = asNumber(req.body?.creditLimit, 0);
  const isActive = req.body?.isActive === false ? 0 : 1;

  if (!code || !name) {
    return res.status(400).json({ error: "Customer code and name are required." });
  }

  const existing = getOne("SELECT id FROM customers WHERE customer_code=?", [code]);
  if (existing.id) {
    return res.status(409).json({ error: "That customer code already exists." });
  }

  writeDatabase((db) => {
    db.run(
      `INSERT INTO customers
       (customer_code, name, phone, email, address, credit_limit, balance, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      [code, name, phone, email, address, creditLimit, isActive],
    );
  });

  return res.status(201).json({ ok: true });
});

app.put("/customers/:id", authRequired, permissionRequired("customers"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  const code = String(req.body?.code ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  const phone = String(req.body?.phone ?? "").trim();
  const email = String(req.body?.email ?? "").trim();
  const address = String(req.body?.address ?? "").trim();
  const creditLimit = asNumber(req.body?.creditLimit, 0);
  const isActive = req.body?.isActive === false ? 0 : 1;

  if (!id || !code || !name) {
    return res.status(400).json({ error: "Customer id, code, and name are required." });
  }

  const existing = getOne("SELECT id FROM customers WHERE id=?", [id]);
  if (!existing.id) {
    return res.status(404).json({ error: "Customer not found." });
  }

  const codeOwner = getOne("SELECT id FROM customers WHERE customer_code=? AND id<>?", [code, id]);
  if (codeOwner.id) {
    return res.status(409).json({ error: "That customer code already belongs to another customer." });
  }

  writeDatabase((db) => {
    db.run(
      `UPDATE customers
       SET customer_code=?, name=?, phone=?, email=?, address=?, credit_limit=?, is_active=?
       WHERE id=?`,
      [code, name, phone, email, address, creditLimit, isActive, id],
    );
  });

  return res.json({ ok: true });
});

app.post("/customers/:id/archive", authRequired, permissionRequired("customers"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid customer id." });
  }
  writeDatabase((db) => {
    db.run("UPDATE customers SET is_active=0 WHERE id=?", [id]);
  });
  return res.json({ ok: true });
});

app.post("/customers/:id/restore", authRequired, permissionRequired("customers"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid customer id." });
  }
  writeDatabase((db) => {
    db.run("UPDATE customers SET is_active=1 WHERE id=?", [id]);
  });
  return res.json({ ok: true });
});

app.get("/customers/:id/payments", authRequired, permissionRequired("customers"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid customer id." });
  }
  const customer = getOne("SELECT id FROM customers WHERE id=?", [id]);
  if (!customer.id) {
    return res.status(404).json({ error: "Customer not found." });
  }
  return res.json(getAll(`
    SELECT id, customer_id AS customerId, amount, paid_at AS paidAt, recorded_at AS recordedAt,
           cashier_id AS cashierId, cashier_name AS cashierName, notes
    FROM customer_payments
    WHERE customer_id=?
    ORDER BY datetime(paid_at) DESC, id DESC
  `, [id]));
});

app.get("/customers/:id/account-ledger", authRequired, permissionRequired("customers"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid customer id." });
  }
  const customer = getOne("SELECT id FROM customers WHERE id=?", [id]);
  if (!customer.id) {
    return res.status(404).json({ error: "Customer not found." });
  }
  return res.json(getAll(`
    SELECT id, customer_id AS customerId, entry_type AS entryType, reference_no AS referenceNo,
           entry_date AS entryDate, description, debit_amount AS debitAmount,
           credit_amount AS creditAmount, discount_amount AS discountAmount,
           balance_after AS balanceAfter, sale_id AS saleId, payment_id AS paymentId,
           created_at AS createdAt
    FROM customer_account_entries
    WHERE customer_id=?
    ORDER BY datetime(entry_date) DESC, id DESC
  `, [id]));
});

app.post("/customers/:id/payments", authRequired, permissionRequired("customers"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  const amount = Math.round(asNumber(req.body?.amount, 0) * 100) / 100;
  const paidAt = String(req.body?.paidAt ?? "").trim();
  const notes = String(req.body?.notes ?? "").trim();
  if (!id) {
    return res.status(400).json({ error: "Invalid customer id." });
  }
  if (amount <= 0) {
    return res.status(400).json({ error: "Payment amount must be greater than zero." });
  }
  if (!paidAt) {
    return res.status(400).json({ error: "Payment date is required." });
  }
  const customer = getOne("SELECT id, name, balance FROM customers WHERE id=?", [id]);
  if (!customer.id) {
    return res.status(404).json({ error: "Customer not found." });
  }
  const currentBalance = Math.round(asNumber(customer.balance, 0) * 100) / 100;
  if (amount > currentBalance) {
    return res.status(400).json({ error: "Payment cannot be greater than the customer's balance." });
  }
  let paymentId = null;
  writeDatabase((db) => {
    db.run("UPDATE customers SET balance=? WHERE id=?", [currentBalance - amount, id]);
    db.run(
      `INSERT INTO customer_payments
       (customer_id, amount, paid_at, cashier_id, cashier_name, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, amount, paidAt, req.user?.id ?? null, req.user?.displayName ?? "", notes],
    );
    const paymentResult = db.exec("SELECT last_insert_rowid() AS id");
    paymentId = paymentResult?.[0]?.values?.[0]?.[0] ?? null;
    db.run(
      `INSERT INTO customer_account_entries
       (customer_id, entry_type, reference_no, entry_date, description, debit_amount, credit_amount,
        discount_amount, balance_after, payment_id)
       VALUES (?, 'PAYMENT', ?, ?, ?, 0, ?, 0, ?, ?)`,
      [id, `PAY-${paymentId}`, paidAt, notes || "Customer payment received", amount, Math.round((currentBalance - amount) * 100) / 100, paymentId],
    );
  });
  return res.status(201).json({
    ok: true,
    balance: Math.round((currentBalance - amount) * 100) / 100,
    ledger: getAll(`
      SELECT id, customer_id AS customerId, entry_type AS entryType, reference_no AS referenceNo,
             entry_date AS entryDate, description, debit_amount AS debitAmount,
             credit_amount AS creditAmount, discount_amount AS discountAmount,
             balance_after AS balanceAfter, sale_id AS saleId, payment_id AS paymentId,
             created_at AS createdAt
      FROM customer_account_entries
      WHERE customer_id=?
      ORDER BY datetime(entry_date) DESC, id DESC
    `, [id]),
    payments: getAll(`
      SELECT id, customer_id AS customerId, amount, paid_at AS paidAt, recorded_at AS recordedAt,
             cashier_id AS cashierId, cashier_name AS cashierName, notes
      FROM customer_payments
      WHERE customer_id=?
      ORDER BY datetime(paid_at) DESC, id DESC
    `, [id]),
  });
});

app.delete("/customers/:id", authRequired, permissionRequired("customers"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid customer id." });
  }
  const existing = getOne("SELECT id, name FROM customers WHERE id=?", [id]);
  if (!existing.id) {
    return res.status(404).json({ error: "Customer not found." });
  }
  writeDatabase((db) => {
    db.run("DELETE FROM customer_payments WHERE customer_id=?", [id]);
    db.run("DELETE FROM customer_account_entries WHERE customer_id=?", [id]);
    db.run("DELETE FROM customers WHERE id=?", [id]);
  });
  return res.json({ ok: true, message: `${existing.name} deleted.` });
});

app.get("/customer-account-activity", authRequired, permissionRequired("sales"), (req, res) => {
  const start = String(req.query.start ?? "2000-01-01");
  const end = String(req.query.end ?? "2099-12-31");
  res.json(getAll(`
    SELECT cae.id, c.name AS customer, c.customer_code AS customerCode,
           cae.entry_type AS entryType, cae.reference_no AS referenceNo,
           cae.entry_date AS entryDate, cae.description,
           cae.debit_amount AS debitAmount, cae.credit_amount AS creditAmount,
           cae.discount_amount AS discountAmount, cae.balance_after AS balanceAfter
    FROM customer_account_entries cae
    INNER JOIN customers c ON c.id = cae.customer_id
    WHERE substr(cae.entry_date,1,10) BETWEEN ? AND ?
    ORDER BY datetime(cae.entry_date) DESC, cae.id DESC
  `, [start, end]));
});

app.get("/sales", authRequired, permissionRequired("sales"), (req, res) => {
  const start = req.query.start ?? "2000-01-01";
  const end = req.query.end ?? "2099-12-31";
  res.json(getAll(`
    SELECT id, receipt_no AS receiptNo, created_at AS createdAt, cashier_name AS cashier,
           customer_name AS customer, total_amount AS total, payment_method AS payment,
           cash_amount AS cash, card_amount AS card, eft_amount AS eft, card_charge_amount AS cardCharge,
           discount_code AS discountCode, discount_name AS discountName, discount_amount AS discountAmount,
           status, sale_type AS saleType
    FROM sales
    WHERE substr(created_at,1,10) BETWEEN ? AND ?
    ORDER BY created_at DESC
  `, [start, end]));
});

app.get("/orders", authRequired, permissionRequired("sales"), (_req, res) => {
  res.json(getOnlineOrders());
});

app.get("/orders/:id", authRequired, permissionRequired("sales"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid order id." });
  }
  const order = getOnlineOrder(id);
  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }
  return res.json(order);
});

app.post("/orders/:id/collect", authRequired, permissionRequired("sales"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid order id." });
  }
  const order = getOnlineOrder(id);
  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }
  if (order.status === "COLLECTED") {
    return res.status(400).json({ error: "Order has already been collected." });
  }
  if (order.status === "CANCELLED") {
    return res.status(400).json({ error: "Cancelled orders cannot be collected." });
  }
  writeDatabase((db) => {
    db.run(
      "UPDATE online_orders SET status='COLLECTED', collected_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [id],
    );
  });
  return res.json({ ok: true, order: getOnlineOrder(id) });
});

app.post("/orders/:id/cancel", authRequired, permissionRequired("sales"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid order id." });
  }
  const order = getOnlineOrder(id);
  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }
  if (order.status === "COLLECTED") {
    return res.status(400).json({ error: "Collected orders cannot be cancelled." });
  }
  if (order.status === "CANCELLED") {
    return res.status(400).json({ error: "Order has already been cancelled." });
  }

  writeDatabase((db) => {
    for (const line of order.lines) {
      const stmt = db.prepare("SELECT id, barcode, name, stock_qty FROM items WHERE id=?");
      stmt.bind([line.itemId]);
      let item = null;
      if (stmt.step()) {
        item = stmt.getAsObject();
      }
      stmt.free();
      if (!item?.id) {
        continue;
      }
      const before = asInteger(item.stock_qty, 0);
      const after = before + asInteger(line.qty, 0);
      db.run("UPDATE items SET stock_qty=? WHERE id=?", [after, item.id]);
      db.run(
        `INSERT INTO stock_movements
         (item_id, barcode, item_name, movement_type, qty_change, stock_before, stock_after, reference_no, notes)
         VALUES (?, ?, ?, 'ONLINE_RELEASE', ?, ?, ?, ?, ?)`,
        [item.id, item.barcode, item.name, line.qty, before, after, order.orderNumber, `Released from cancelled online order ${order.orderNumber}`],
      );
    }
    db.run(
      "UPDATE online_orders SET status='CANCELLED', updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [id],
    );
  });

  return res.json({ ok: true, order: getOnlineOrder(id) });
});

app.get("/stock-movements", authRequired, permissionRequired("stock"), (req, res) => {
  const start = req.query.start ?? "2000-01-01";
  const end = req.query.end ?? "2099-12-31";
  res.json(getAll(`
    SELECT id, created_at AS createdAt, barcode, item_name AS item, movement_type AS type,
           qty_change AS change, stock_before AS before, stock_after AS after, reference_no AS reference, notes
    FROM stock_movements
    WHERE substr(created_at,1,10) BETWEEN ? AND ?
    ORDER BY created_at DESC, id DESC
  `, [start, end]));
});

app.get("/cashups/day-end-summary", authRequired, permissionRequired("cashups"), (req, res) => {
  const date = String(req.query.date ?? new Date().toISOString().slice(0, 10)).trim();
  const summary = getDaySummary(date);
  const recent = getAll(`
    SELECT id, cashup_date AS cashupDate, closed_at AS closedAt, cashier_name AS cashier,
           total_sales AS totalSales, sale_count AS saleCount, total_returns AS totalReturns,
           return_count AS returnCount, net_total AS netTotal, expected_cash AS expectedCash,
           counted_cash AS countedCash, cash_difference AS cashDifference, expected_card AS expectedCard,
           expected_eft AS expectedEft, denomination_breakdown AS denominationBreakdown
    FROM day_end_cashups
    ORDER BY id DESC
    LIMIT 30
  `);
  res.json({ date, summary, recent });
});

app.post("/cashups/day-end", authRequired, permissionRequired("cashups"), (req, res) => {
  const date = String(req.body?.date ?? new Date().toISOString().slice(0, 10)).trim();
  const countedCash = asNumber(req.body?.countedCash, NaN);
  const denominationBreakdown = typeof req.body?.denominationBreakdown === "string"
    ? req.body.denominationBreakdown
    : JSON.stringify(req.body?.denominationBreakdown ?? {});
  if (!Number.isFinite(countedCash)) {
    return res.status(400).json({ error: "Counted cash must be numeric." });
  }
  const summary = getDaySummary(date);
  const cashDifference = Math.round((countedCash - asNumber(summary.expectedCash, 0)) * 100) / 100;
  const closedAt = new Date().toISOString();

  const createdId = writeDatabase((db) => {
    db.run(
      `INSERT INTO day_end_cashups
       (cashup_date, closed_at, cashier_name, total_sales, sale_count, total_returns, return_count, net_total,
        expected_cash, counted_cash, cash_difference, expected_card, expected_eft, denomination_breakdown)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        date,
        closedAt,
        req.user.displayName || req.user.username,
        asNumber(summary.totalSales, 0),
        asInteger(summary.saleCount, 0),
        asNumber(summary.totalReturns, 0),
        asInteger(summary.returnCount, 0),
        asNumber(summary.netTotal, 0),
        asNumber(summary.expectedCash, 0),
        countedCash,
        cashDifference,
        asNumber(summary.expectedCard, 0),
        asNumber(summary.expectedEft, 0),
        denominationBreakdown,
      ],
    );
    const row = db.exec("SELECT last_insert_rowid() AS id");
    return row?.[0]?.values?.[0]?.[0] ?? null;
  });

  const record = getOne(`
    SELECT id, cashup_date AS cashupDate, closed_at AS closedAt, cashier_name AS cashier,
           total_sales AS totalSales, sale_count AS saleCount, total_returns AS totalReturns,
           return_count AS returnCount, net_total AS netTotal, expected_cash AS expectedCash,
           counted_cash AS countedCash, cash_difference AS cashDifference, expected_card AS expectedCard,
           expected_eft AS expectedEft, denomination_breakdown AS denominationBreakdown
    FROM day_end_cashups
    WHERE id=?
  `, [createdId]);

  res.status(201).json({ ok: true, record });
});

app.get("/receiving/drafts", authRequired, permissionRequired("stock"), (_req, res) => {
  res.json(getInvoiceDrafts());
});

app.get("/receiving/drafts/:id", authRequired, permissionRequired("stock"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid draft id." });
  }
  const draft = getInvoiceDraft(id);
  if (!draft) {
    return res.status(404).json({ error: "Draft not found." });
  }
  return res.json(draft);
});

app.post("/receiving/drafts/parse", authRequired, permissionRequired("stock"), (req, res) => {
  const rawText = String(req.body?.rawText ?? "").trim();
  const supplierNameInput = String(req.body?.supplierName ?? "").trim();
  const invoiceNumberInput = String(req.body?.invoiceNumber ?? "").trim();
  const invoiceDateInput = String(req.body?.invoiceDate ?? "").trim();
  const sourceType = String(req.body?.sourceType ?? "MANUAL_TEXT").trim() || "MANUAL_TEXT";

  if (!rawText) {
    return res.status(400).json({ error: "Paste invoice text to create a draft." });
  }

  const parsed = parseInvoiceText(rawText);
  const supplierName = supplierNameInput || parsed.supplierName || "Unknown Supplier";
  const supplierId = detectSupplierIdByName(supplierName);
  const invoiceNumber = invoiceNumberInput || parsed.invoiceNumber || `DRAFT-${Date.now()}`;
  const invoiceDate = invoiceDateInput || parsed.invoiceDate || new Date().toISOString().slice(0, 10);

  const created = writeDatabase((db) => {
    db.run(
      `INSERT INTO supplier_invoice_drafts
       (supplier_id, supplier_name, invoice_number, invoice_date, total_amount, status, source_type, raw_text, parse_notes, created_by)
       VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`,
      [supplierId, supplierName, invoiceNumber, invoiceDate, asNumber(parsed.totalAmount, 0), sourceType, rawText, parsed.parseNotes, req.user.displayName || req.user.username],
    );
    const result = db.exec("SELECT last_insert_rowid() AS id");
    const draftId = result?.[0]?.values?.[0]?.[0] ?? null;
    parsed.lines.forEach((line, index) => {
      db.run(
        `INSERT INTO supplier_invoice_draft_lines
         (draft_id, line_no, raw_description, qty, unit_price, line_total, matched_item_id, matched_barcode, matched_item_name, match_confidence, review_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          draftId,
          index + 1,
          line.rawDescription,
          asNumber(line.qty, 0),
          asNumber(line.unitPrice, 0),
          asNumber(line.lineTotal, 0),
          line.matchedItemId,
          line.matchedBarcode,
          line.matchedItemName,
          asNumber(line.matchConfidence, 0),
          line.reviewStatus,
        ],
      );
    });
    return draftId;
  });

  return res.status(201).json({ ok: true, draft: getInvoiceDraft(created) });
});

app.put("/receiving/drafts/:id", authRequired, permissionRequired("stock"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid draft id." });
  }
  const draft = getInvoiceDraft(id);
  if (!draft) {
    return res.status(404).json({ error: "Draft not found." });
  }
  const supplierId = req.body?.supplierId ? asInteger(req.body.supplierId, 0) : null;
  const supplierName = String(req.body?.supplierName ?? draft.supplierName ?? "").trim();
  const invoiceNumber = String(req.body?.invoiceNumber ?? draft.invoiceNumber ?? "").trim();
  const invoiceDate = String(req.body?.invoiceDate ?? draft.invoiceDate ?? "").trim();
  const totalAmount = asNumber(req.body?.totalAmount, draft.totalAmount ?? 0);
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];

  writeDatabase((db) => {
    db.run(
      `UPDATE supplier_invoice_drafts
       SET supplier_id=?, supplier_name=?, invoice_number=?, invoice_date=?, total_amount=?
       WHERE id=?`,
      [supplierId, supplierName, invoiceNumber, invoiceDate, totalAmount, id],
    );
    db.run("DELETE FROM supplier_invoice_draft_lines WHERE draft_id=?", [id]);
    lines.forEach((line, index) => {
      const matchedItemId = line.matchedItemId ? asInteger(line.matchedItemId, 0) : null;
      let matchedBarcode = String(line.matchedBarcode ?? "").trim();
      let matchedItemName = String(line.matchedItemName ?? "").trim();
      let confidence = asNumber(line.matchConfidence, 0);
      if (matchedItemId) {
        const stmt = db.prepare("SELECT barcode, name FROM items WHERE id=?");
        stmt.bind([matchedItemId]);
        let item = {};
        if (stmt.step()) {
          item = stmt.getAsObject();
        }
        stmt.free();
        matchedBarcode = item.barcode || matchedBarcode;
        matchedItemName = item.name || matchedItemName;
        if (!confidence) confidence = 1;
      }
      db.run(
        `INSERT INTO supplier_invoice_draft_lines
         (draft_id, line_no, raw_description, qty, unit_price, line_total, matched_item_id, matched_barcode, matched_item_name, match_confidence, review_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          index + 1,
          String(line.rawDescription ?? "").trim(),
          asNumber(line.qty, 0),
          asNumber(line.unitPrice, 0),
          asNumber(line.lineTotal, 0),
          matchedItemId,
          matchedBarcode,
          matchedItemName,
          confidence,
          matchedItemId ? "MATCHED" : "NEEDS_REVIEW",
        ],
      );
    });
  });

  return res.json({ ok: true, draft: getInvoiceDraft(id) });
});

app.post("/receiving/drafts/:id/approve", authRequired, permissionRequired("stock"), (req, res) => {
  const id = asInteger(req.params.id, 0);
  if (!id) {
    return res.status(400).json({ error: "Invalid draft id." });
  }
  const draft = getInvoiceDraft(id);
  if (!draft) {
    return res.status(404).json({ error: "Draft not found." });
  }
  if (draft.status === "APPROVED") {
    return res.status(400).json({ error: "This draft has already been approved." });
  }
  const unmatched = draft.lines.filter((line) => !line.matchedItemId);
  if (unmatched.length) {
    return res.status(400).json({ error: "Match all invoice lines to products before approving." });
  }

  const receiptNumber = `WEBREC-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
  writeDatabase((db) => {
    db.run(
      "INSERT INTO purchase_orders (po_number, supplier_id, supplier_name, status, notes, created_at) VALUES (?, ?, ?, 'RECEIVED', ?, CURRENT_TIMESTAMP)",
      [receiptNumber, draft.supplierId, draft.supplierName, `Approved from supplier invoice draft ${draft.invoiceNumber}`],
    );

    draft.lines.forEach((line) => {
      const stmt = db.prepare("SELECT id, barcode, name, stock_qty FROM items WHERE id=?");
      stmt.bind([line.matchedItemId]);
      let item = null;
      if (stmt.step()) {
        item = stmt.getAsObject();
      }
      stmt.free();
      if (!item?.id) {
        return;
      }
      const before = asNumber(item.stock_qty, 0);
      const qty = asNumber(line.qty, 0);
      const after = before + qty;
      db.run("UPDATE items SET stock_qty=? WHERE id=?", [after, line.matchedItemId]);
      db.run(
        `INSERT INTO stock_movements
         (item_id, barcode, item_name, movement_type, qty_change, stock_before, stock_after, reference_no, notes)
         VALUES (?, ?, ?, 'RECEIVE', ?, ?, ?, ?, ?)`,
        [item.id, item.barcode, item.name, qty, before, after, receiptNumber, `Invoice ${draft.invoiceNumber}`],
      );
    });

    db.run("UPDATE supplier_invoice_drafts SET status='APPROVED', approved_at=CURRENT_TIMESTAMP WHERE id=?", [id]);
  });

  return res.json({ ok: true, draft: getInvoiceDraft(id), receiptNumber });
});

app.get("/reports/summary", authRequired, permissionRequired("sales"), (req, res) => {
  const start = req.query.start ?? "2000-01-01";
  const end = req.query.end ?? "2099-12-31";
  const summary = getOne(`
    SELECT
      COALESCE(SUM(CASE WHEN sale_type='SALE' AND status='COMPLETED' THEN total_amount ELSE 0 END),0) AS totalSales,
      COALESCE(SUM(CASE WHEN sale_type='SALE' AND status='COMPLETED' THEN 1 ELSE 0 END),0) AS saleCount,
      COALESCE(SUM(CASE WHEN sale_type='RETURN' AND status='COMPLETED' THEN ABS(total_amount) ELSE 0 END),0) AS totalReturns,
      COALESCE(SUM(CASE WHEN sale_type='RETURN' AND status='COMPLETED' THEN 1 ELSE 0 END),0) AS returnCount,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN total_amount ELSE 0 END),0) AS netTotal,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN cash_amount ELSE 0 END),0) AS cash,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN card_amount ELSE 0 END),0) AS card,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN eft_amount ELSE 0 END),0) AS eft,
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN card_charge_amount ELSE 0 END),0) AS cardCharges,
      COALESCE((
        SELECT SUM(COALESCE(sl.qty, 0) * COALESCE(i.cost_price, 0))
        FROM sale_lines sl
        INNER JOIN sales s2 ON s2.id = sl.sale_id
        LEFT JOIN items i ON i.id = sl.item_id
        WHERE s2.status='COMPLETED'
          AND s2.sale_type='SALE'
          AND substr(s2.created_at,1,10) BETWEEN ? AND ?
      ),0) AS costOfGoodsSold
    FROM sales
    WHERE substr(created_at,1,10) BETWEEN ? AND ?
  `, [start, end, start, end]);
  summary.creditSalesOut = Number(getOne(`
    SELECT COALESCE(SUM(debit_amount),0) AS amount
    FROM customer_account_entries
    WHERE substr(entry_date,1,10) BETWEEN ? AND ?
      AND entry_type='CREDIT_SALE'
  `, [start, end]).amount || 0);
  summary.customerPaymentsIn = Number(getOne(`
    SELECT COALESCE(SUM(credit_amount),0) AS amount
    FROM customer_account_entries
    WHERE substr(entry_date,1,10) BETWEEN ? AND ?
      AND entry_type='PAYMENT'
  `, [start, end]).amount || 0);
  summary.realizedRevenue = summary.customerPaymentsIn - summary.creditSalesOut;
  summary.grossProfit = summary.realizedRevenue;
  res.json(summary);
});

app.get("/reports/top-products", authRequired, permissionRequired("sales"), (req, res) => {
  const start = String(req.query.start ?? "2000-01-01");
  const end = String(req.query.end ?? "2099-12-31");
  const rows = getAll(`
    SELECT
      COALESCE(sl.barcode, '') AS barcode,
      COALESCE(sl.item_name, 'Unknown Item') AS item,
      COALESCE(SUM(sl.qty), 0) AS qtySold,
      COALESCE(SUM(sl.line_total), 0) AS revenue,
      COALESCE(SUM(COALESCE(sl.qty, 0) * COALESCE(i.cost_price, 0)), 0) AS costOfGoodsSold
    FROM sale_lines sl
    INNER JOIN sales s ON s.id = sl.sale_id
    LEFT JOIN items i ON i.id = sl.item_id
    WHERE s.status='COMPLETED'
      AND s.sale_type='SALE'
      AND substr(s.created_at,1,10) BETWEEN ? AND ?
    GROUP BY COALESCE(sl.barcode, ''), COALESCE(sl.item_name, 'Unknown Item')
    ORDER BY qtySold DESC, revenue DESC, item ASC
    LIMIT 12
  `, [start, end]).map((row) => ({
    ...row,
    qtySold: Number(row.qtySold || 0),
    revenue: Number(row.revenue || 0),
    costOfGoodsSold: Number(row.costOfGoodsSold || 0),
    grossProfit: Number(row.revenue || 0) - Number(row.costOfGoodsSold || 0),
  }));

  const totals = rows.reduce((acc, row) => ({
    qtySold: acc.qtySold + row.qtySold,
    revenue: acc.revenue + row.revenue,
    costOfGoodsSold: acc.costOfGoodsSold + row.costOfGoodsSold,
    grossProfit: acc.grossProfit + row.grossProfit,
  }), { qtySold: 0, revenue: 0, costOfGoodsSold: 0, grossProfit: 0 });

  res.json({
    start,
    end,
    rows,
    totals,
  });
});

app.post("/backup/export", authRequired, permissionRequired("backup"), adminRequired, (_req, res) => {
  const snapshot = {
    exportedAt: new Date().toISOString(),
    products: getAll("SELECT * FROM items ORDER BY name"),
    suppliers: getAll("SELECT * FROM suppliers ORDER BY name"),
    customers: getAll("SELECT * FROM customers ORDER BY name"),
    sales: getAll("SELECT * FROM sales ORDER BY created_at DESC"),
    saleLines: getAll("SELECT * FROM sale_lines ORDER BY id DESC"),
    stockMovements: getAll("SELECT * FROM stock_movements ORDER BY created_at DESC"),
    shifts: getAll("SELECT * FROM shifts ORDER BY id DESC"),
    dayEndCashups: getAll("SELECT * FROM day_end_cashups ORDER BY id DESC"),
    purchaseOrders: getAll("SELECT * FROM purchase_orders ORDER BY id DESC"),
  };
  const filename = `simple-pos-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const filePath = path.join(BACKUP_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf-8");
  res.json({ filename, filePath });
});

app.post("/backup/reset-activity", authRequired, permissionRequired("backup"), adminRequired, (req, res) => {
  const confirmation = String(req.body?.confirmation ?? "").trim().toUpperCase();
  if (confirmation !== "RESET") {
    return res.status(400).json({ error: "Type RESET to clear test activity." });
  }

  writeDatabase((db) => {
    db.run("DELETE FROM sale_lines");
    db.run("DELETE FROM sales");
    db.run("DELETE FROM shifts");
    db.run("DELETE FROM day_end_cashups");
    db.run("DELETE FROM online_order_lines");
    db.run("DELETE FROM online_orders");
    db.run("DELETE FROM supplier_invoice_draft_lines");
    db.run("DELETE FROM supplier_invoice_drafts");
    db.run("DELETE FROM purchase_orders");
    db.run("DELETE FROM stock_movements");
    db.run("DELETE FROM customer_payments");
    db.run("DELETE FROM customer_account_entries");
    db.run("UPDATE customers SET balance=0");
  });

  return res.json({
    ok: true,
    message: "Sales, orders, cash-ups, stock history, receiving drafts, and customer balances were cleared. Products, suppliers, and customers were kept.",
  });
});

if (!IS_VERCEL) {
  app.listen(PORT, HOST, () => {
    console.log(`Simple POS API running at http://${HOST}:${PORT}`);
  });
}

export default app;
