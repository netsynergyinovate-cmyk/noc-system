// Grants a role to an existing account: npm run role:set -- <email> <superadmin|admin|user>
// Roles are only meaningful if they exist in src/lib/permissions.ts. Signup
// never sets a role, so promoting the first admin happens here.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { loadEnvironment, root } from "./lib.mjs";
import { databaseUrl, databaseError } from "./postgres.mjs";

const [email, role] = process.argv.slice(2);
if (!email || !role) {
  console.error(
    "Usage: npm run role:set -- <email> <superadmin|admin|user>\n" +
      "Use a comma-separated list to grant several roles, e.g. superadmin,admin.\n" +
      'Pass "" to clear the role and fall back to the default (user).',
  );
  process.exit(1);
}
if (!/^[a-z0-9_,-]*$/i.test(role)) {
  console.error("A role name may contain letters, digits, _, - and commas.");
  process.exit(1);
}

// Read the declared roles so a typo is caught before it silently grants nothing.
const permissionsContent = readFileSync(
  resolve(root, "src/lib/permissions.ts"),
  "utf8",
);
const rolesBlock =
  permissionsContent.split(/export\s+const\s+roles/)[1] ?? "";
const declared = [
  ...rolesBlock.matchAll(/^\s*([A-Za-z0-9_]+)\s*:\s*ac\.newRole/gm),
].map((match) => match[1]);
const unknown = role
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name && !declared.includes(name));
if (unknown.length)
  console.warn(
    `Warning: ${unknown.join(", ")} is not declared in src/lib/permissions.ts and grants nothing.`,
  );

await loadEnvironment();
const pool = new Pool({
  connectionString: databaseUrl(),
  max: 1,
  connectionTimeoutMillis: 5000,
});
pool.on("error", () => {});
try {
  const { rows } = await pool.query(
    'UPDATE "user" SET role = $1, updated_at = now() WHERE lower(email) = lower($2) RETURNING email, role',
    [role || null, email],
  );
  if (!rows.length) {
    console.error(`No account found for ${email}. Sign up first, then retry.`);
    process.exitCode = 1;
  } else {
    console.log(
      `${rows[0].email} now has role: ${rows[0].role ?? "(default)"}`,
    );
    console.log("Sign out and back in, or reload, to pick up the new access.");
  }
} catch (error) {
  console.error(databaseError(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
