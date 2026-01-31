// /functions/auth.js
// Better-auth implementation
import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import { integer, text, sqliteTable } from "drizzle-orm/sqlite-core";

const dbInstance = new Database(':memory:');

// Define Better Auth schema (for reference, but not used directly)
const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id),
});

const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

let auth;
try {
    auth = betterAuth({
        database: dbInstance,
        emailAndPassword: {
            enabled: true,
            autoSignIn: false,
        },
        baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5173",
        trustedOrigins: ["http://localhost:5173", "https://sturdy-spork-55jvj4qw6543qx9-5173.app.github.dev"],
    });
} catch (err) {
    console.error('Failed to initialize betterAuth:', err);
    // Fallback handler that returns 500 and logs the issue so the dev server stays up
    auth = {
        handler: (req, res) => {
            try {
                const url = new URL(req.url, 'http://localhost');
                if (req.method === 'GET' && (url.pathname === '/api/auth/status' || url.pathname === '/api/auth/health')) {
                    res.statusCode = 503;
                    res.setHeader('Content-Type', 'application/json');
                    return res.end(JSON.stringify({ ok: false, error: 'Auth not initialized' }));
                }
            } catch (e) {
                console.error('Error parsing request URL in fallback handler:', e);
            }

            console.error('Auth handler called but auth failed to initialize:', err);
            try {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Auth not initialized' }));
            } catch (e) {
                console.error('Failed to send fallback response:', e);
            }
        }
    };
}

export { auth };

export default async function handler(req, context) {
    return auth.handler(req);
}