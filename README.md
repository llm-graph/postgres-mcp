# FastPostgresMCP 🐘⚡️ (Full-Featured Multi-DB MCP Server)

**This project implements a blazing fast, type-safe, and full-featured Model Context Protocol (MCP) Server designed for AI Agents (like Cursor, Claude Desktop) to interact with multiple PostgreSQL databases, including listing tables and inspecting schemas.**

It is built with Bun, TypeScript, `postgres`, and leverages advanced features of the `fastmcp` framework for building robust MCP servers.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Powered by fastmcp](https://img.shields.io/badge/Powered%20by-fastmcp-blue)](https://github.com/punkpeye/fastmcp)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-_000)](https://bun.sh)
[![Uses postgres](https://img.shields.io/badge/Uses-postgres-336791)](https://github.com/porsager/postgres)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)](https://www.typescriptlang.org/)

## Purpose: An MCP Server for AI Agents

This is **not** a library to be imported into your code. It is a **standalone server application**. You run it as a process, and MCP clients (like AI agents) communicate with it using the JSON-based Model Context Protocol (v2.0), typically over a `stdio` connection managed by the client application (e.g., Cursor).

## ✨ Core Features

*   **🚀 Blazing Fast:** Built on Bun and `fastmcp`.
*   **🔒 Type-Safe:** End-to-end TypeScript with Zod schema validation.
*   **🐘 Multi-Database Support:** Connect to and manage interactions across several PostgreSQL instances defined in `.env`.
*   **🛡️ Secure by Design:** Parameterized queries via `postgres` prevent SQL injection.
*   **🔑 Optional Authentication:** Secure network-based connections (SSE/HTTP) using API Key validation (`fastmcp`'s `authenticate` hook).
*   **📄 Database Schema via MCP Resources:**
    *   **List Tables:** Get a list of tables in a database via `db://{dbAlias}/schema/tables`.
    *   **Inspect Table Schema:** Get detailed column info for a specific table via `db://{dbAlias}/schema/{tableName}`.
*   **💬 Enhanced Tool Interaction:**
    *   **In-Tool Logging:** Tools send detailed logs back to the client (`log` context).
    *   **Progress Reporting:** Long-running operations report progress (`reportProgress` context).
*   **🧠 Session-Aware:** Access session information within tool execution context (`session` context).
*   **📡 Event-Driven:** Uses `server.on` and `session.on` for connection/session event handling.
*   **🔧 Modern Developer Experience (DX):** Clear configuration, intuitive API, easy testing with `fastmcp` tools.

## What's Included (fastmcp Features Leveraged)

*   `FastMCP` Server Core
*   `server.addTool` (for `query`, `execute`, `transaction`)
*   `server.addResourceTemplate` (for listing tables and inspecting table schemas)
*   `server.start` (with `stdio` focus, adaptable for `sse`/`http`)
*   **Optional:** `authenticate` Hook (for API Key validation)
*   Tool Execution `context` (`log`, `reportProgress`, `session`)
*   Zod for Parameter Schema Validation
*   `server.on` (for connection logging)
*   (Potentially) `session.on` for session-specific logic

## 📋 Prerequisites

*   **[Bun](https://bun.sh/) (v1.0 or later recommended):** Installed and in PATH.
*   **PostgreSQL Database(s):** Access credentials and connectivity. User needs permissions to query `information_schema`.

## ⚙️ Installation

1.  **Clone the repository:**
    ```bash
    # Replace with your actual repository URL
    git clone https://github.com/yourusername/fast-postgres-mcp.git
    cd fast-postgres-mcp
    ```

2.  **Install dependencies:**
    ```bash
    bun install
    ```

## 🔑 Configuration (Multi-Database & Optional Auth)

Configure via environment variables, typically loaded from `.env`.

1.  **Create `.env` file:** `cp .env.example .env`
2.  **Edit `.env`:** Define `DB_ALIASES`, `DEFAULT_DB_ALIAS`, database connection details (`DB_<ALIAS>_...`), and optional `ENABLE_AUTH`/`MCP_API_KEY`.

```dotenv
# .env.example - Key Variables

# REQUIRED: Comma-separated list of unique DB aliases
DB_ALIASES=main,reporting

# REQUIRED: Default alias if 'dbAlias' is omitted in tool calls
DEFAULT_DB_ALIAS=main

# OPTIONAL: Enable API Key auth (primarily for network transports)
ENABLE_AUTH=false
MCP_API_KEY=your_super_secret_api_key_here # CHANGE THIS

# Define DB connection details for each alias (DB_MAIN_*, DB_REPORTING_*, etc.)
# Example:
DB_MAIN_HOST=localhost
DB_MAIN_PORT=5432
DB_MAIN_NAME=app_prod_db
DB_MAIN_USER=app_user         # Needs permissions on information_schema
DB_MAIN_PASSWORD=app_secret_password
DB_MAIN_SSL=disable           # Recommend 'require' or stricter for prod

DB_REPORTING_HOST=reporting-db.read-replica.internal
# ... other reporting DB details ...
DB_REPORTING_USER=readonly_reporter # Needs permissions on information_schema

# --- Optional: Server Logging Level ---
# LOG_LEVEL=info # debug, info, warn, error (defaults to info)
```

## 🚀 Running the Server (as a Process)

Run this server directly using Bun. The AI Client (like Cursor) will typically start and manage this command for you.

*   **To run manually (for testing):** `bun run src/index.ts`
*   **Manual Development Mode:** `bun run --watch src/index.ts`

### Testing with `fastmcp` CLI Tools

*   **Interactive Terminal:** `bunx fastmcp dev src/index.ts`
*   **Web UI Inspector:** `bunx fastmcp inspect src/index.ts`

## 🔌 Connecting with AI Clients (Cursor, Claude Desktop)

Configure your AI Agent (MCP Client) to **execute** this server script via its command/args mechanism.

### Cursor AI - Detailed Example

1.  Open Cursor Settings/Preferences (Cmd+, or Ctrl+,).
2.  Navigate to "Extensions" -> "MCP".
3.  Click "Add MCP Server" or edit `settings.json`.
4.  Add the following JSON configuration:

    ```json
    // In Cursor's settings.json or MCP configuration UI
    {
      "mcpServers": {
        "fast-postgres-mcp": { // Unique name for Cursor
          "description": "MCP Server for PostgreSQL DBs (Main, Reporting)",
          "command": "bun",  // Use 'bun' or provide absolute path: "/Users/your_username/.bun/bin/bun"
          "args": [
            "run",
            // *** CRITICAL: ABSOLUTE PATH to your server's entry point ***
            "/Users/your_username/projects/fast-postgres-mcp/src/index.ts" // CHANGE THIS
          ],
          "env": {
            // .env file in project dir is loaded automatically by Bun.
            // Add overrides or Cursor-specific vars here if needed.
          },
          "enabled": true
        }
      }
    }
    ```

5.  **Save** and **Restart Cursor** or "Reload MCP Servers".
6.  **Verify** connection in Cursor's MCP status/logs.

### Claude Desktop

1.  Locate and edit `config.json` (see previous README for paths).
2.  Add a similar entry under `mcpServers`, using the **absolute path** in `args`.
3.  Restart Claude Desktop.

## 🛠️ MCP Capabilities Exposed

### Authentication (Optional)

*   Secures network transports (HTTP/SSE) via `X-API-Key` header matching `MCP_API_KEY` if `ENABLE_AUTH=true`.
*   `stdio` connections (default for Cursor/Claude) generally bypass this check.

### Resources

#### 1. List Database Tables

*   **URI Template:** `db://{dbAlias}/schema/tables`
*   **Description:** Retrieves a list of user table names within the specified database alias (typically from the 'public' schema).
*   **Resource Definition (`addResourceTemplate`):**
    *   `uriTemplate`: `"db://{dbAlias}/schema/tables"`
    *   `arguments`:
        *   `dbAlias`: (string, required) - Alias of the database (from `.env`).
    *   `load({ dbAlias })`: Connects to the database, queries `information_schema.tables` (filtered for base tables in the public schema, customizable in implementation), formats the result as a JSON string array `["table1", "table2", ...]`, and returns `{ text: "..." }`.

**Example Usage (AI Prompt):** "Get the resource `db://main/schema/tables` to list tables in the main database."

#### 2. Inspect Table Schema

*   **URI Template:** `db://{dbAlias}/schema/{tableName}`
*   **Description:** Provides detailed schema information (columns, types, nullability, defaults) for a specific table.
*   **Resource Definition (`addResourceTemplate`):**
    *   `uriTemplate`: `"db://{dbAlias}/schema/{tableName}"`
    *   `arguments`:
        *   `dbAlias`: (string, required) - Database alias.
        *   `tableName`: (string, required) - Name of the table.
    *   `load({ dbAlias, tableName })`: Connects, queries `information_schema.columns` for the specific table, formats as JSON string array of column objects, returns `{ text: "..." }`.

**Example Usage (AI Prompt):** "Describe the resource `db://reporting/schema/daily_sales`."

**Example Request:**
```json
{
  "tool_name": "schema_tool",
  "arguments": {
    "tableName": "user_sessions",
    "dbAlias": "main"
  }
}
```

**Example Response Content (JSON String):**
```json
"[{\"column_name\":\"session_id\",\"data_type\":\"uuid\",\"is_nullable\":\"NO\",\"column_default\":\"gen_random_uuid()\"},{\"column_name\":\"user_id\",\"data_type\":\"integer\",\"is_nullable\":\"NO\",\"column_default\":null},{\"column_name\":\"created_at\",\"data_type\":\"timestamp with time zone\",\"is_nullable\":\"YES\",\"column_default\":\"now()\"},{\"column_name\":\"expires_at\",\"data_type\":\"timestamp with time zone\",\"is_nullable\":\"YES\",\"column_default\":null}]"
```

### Tools

Tools receive `context` object (`log`, `reportProgress`, `session`).

---

#### 1. `query_tool`

Executes read-only SQL queries.

*   **Description:** Safely execute read-only SQL, get results, with execution logging/progress.
*   **Parameters:** `statement` (string), `params` (array, opt), `dbAlias` (string, opt).
*   **Context Usage:** `log.info/debug`, optional `reportProgress`, access `session`.
*   **Returns:** JSON string of the row array.

**Example Request:**
```json
{
  "tool_name": "query_tool",
  "arguments": {
    "statement": "SELECT product_id, name, price FROM products WHERE category = $1 AND price < $2 ORDER BY name LIMIT 10",
    "params": ["electronics", 500],
    "dbAlias": "main"
  }
}
```

**Example Response Content (JSON String):**
```json
"[{\"product_id\":123,\"name\":\"Example Gadget\",\"price\":499.99},{\"product_id\":456,\"name\":\"Another Device\",\"price\":350.00}]"
```

---

---

#### 2. `execute_tool`

Executes data-modifying SQL statements.

*   **Description:** Safely execute data-modifying SQL, with execution logging.
*   **Parameters:** `statement` (string), `params` (array, opt), `dbAlias` (string, opt).
*   **Context Usage:** `log.info/debug`, access `session`.
*   **Returns:** String indicating rows affected.

**Example Request:**
```json
{
  "tool_name": "execute_tool",
  "arguments": {
    "statement": "UPDATE users SET last_login = NOW() WHERE user_id = $1",
    "params": [54321]
    // dbAlias omitted, uses DEFAULT_DB_ALIAS
  }
}
```

**Example Response Content (String):**
```"Rows affected: 1"
```

---

#### 3. `transaction_tool`

Executes multiple SQL statements atomically.

*   **Description:** Execute SQL sequence in a transaction, with step logging/progress.
*   **Parameters:** `operations` (array of {statement, params}), `dbAlias` (string, opt).
*   **Context Usage:** `log.info/debug/error`, `reportProgress`, access `session`.
*   **Returns:** JSON string summarizing success/failure: `{"success": true, "results": [...]}` or `{"success": false, "error": ..., "failedOperationIndex": ...}`.


**Example Request:**
```json
{
  "tool_name": "transaction_tool",
  "arguments": {
    "operations": [
      {
        "statement": "INSERT INTO orders (customer_id, order_date, status) VALUES ($1, NOW(), 'pending') RETURNING order_id",
        "params": [101]
        // Note: Simple version doesn't automatically handle passing RETURNING values between operations.
        // More complex workflows might need separate tool calls or enhanced logic.
      },
      {
        "statement": "INSERT INTO order_items (order_id, product_sku, quantity, price) VALUES ($1, $2, $3, $4)",
        "params": [/* placeholder for returned order_id */ 9999, "GADGET-X", 2, 49.99]
      },
      {
        "statement": "UPDATE inventory SET stock_count = stock_count - $1 WHERE product_sku = $2 AND stock_count >= $1",
        "params": [2, "GADGET-X"]
      }
    ],
    "dbAlias": "main"
  }
}
```

**Example Success Response Content (JSON String):**
```json
"{\"success\":true,\"results\":[{\"operation\":0,\"rowsAffected\":1},{\"operation\":1,\"rowsAffected\":1},{\"operation\":2,\"rowsAffected\":1}]}"
```

**Example Error Response Content (JSON String):**
```json
"{\"success\":false,\"error\":\"Error executing operation 2: new row for relation \\\"inventory\\\" violates check constraint \\\"stock_count_non_negative\\\"\",\"failedOperationIndex\":2}"
```

---


### Server & Session Events

*   Uses `server.on('connect'/'disconnect')` for logging client connections.
*   Can use `session.on(...)` for more granular session event handling if needed.

## 🔒 Security Considerations

*   **SQL Injection:** Mitigated via parameterized queries. **No direct input concatenation.**
*   **Database Permissions:** **Critical.** Assign least privilege to each `DB_<ALIAS>_USER`, including read access to `information_schema` for schema/table listing resources.
*   **SSL/TLS:** **Essential** for production (`DB_<ALIAS>_SSL=require` or stricter).
*   **Secrets Management:** Protect `.env` file (add to `.gitignore`). Use secure secret management for production environments (Vault, Doppler, cloud secrets).
*   **Authentication Scope:** `authenticate` hook primarily secures network transports. `stdio` security relies on the execution environment.
*   **Data Sensitivity:** Be aware of data accessible via connections/tools.
*   **Resource Queries:** The queries used for listing tables (`information_schema.tables`) and schemas (`information_schema.columns`) are generally safe but rely on database permissions. Ensure the configured users have appropriate read access. Customize the table listing query (e.g., schema filtering) if needed for security or clarity.

## 📜 License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details. (Ensure a LICENSE file exists).




















Okay, here is the final, comprehensive `README.md` incorporating the multi-database setup, refined API descriptions, detailed instructions for Cursor AI and Claude Desktop integration, and aiming for excellent developer experience.

```markdown
# FastPostgresMCP 🐘⚡️ (Multi-DB Edition)

**A blazing fast, type-safe Model Context Protocol (MCP) server for interacting with *multiple* PostgreSQL databases, built with Bun, TypeScript, `postgres`, and `fastmcp`.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Powered by fastmcp](https://img.shields.io/badge/Powered%20by-fastmcp-blue)](https://github.com/punkpeye/fastmcp)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-_000)](https://bun.sh)
[![Uses postgres](https://img.shields.io/badge/Uses-postgres-336791)](https://github.com/porsager/postgres)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)](https://www.typescriptlang.org/)

This server acts as a secure and efficient bridge, enabling AI models and other MCP clients (like Cursor or Claude Desktop) to interact with one or more PostgreSQL databases using a standardized protocol. It's designed for performance, safety, and ease of use.

## ✨ Core Features

*   **🚀 Blazing Fast:** Leverages Bun's runtime speed and `fastmcp`'s efficient design.
*   **🔒 Type-Safe:** End-to-end TypeScript with Zod schema validation for robust parameter handling.
*   **🐘 Multi-Database Support:** Seamlessly connect to and manage interactions across multiple PostgreSQL instances configured via environment variables.
*   **🛡️ Secure by Design:** Prevents SQL injection using the `postgres` driver's tagged template literals and parameterized queries.
*   **🔧 Modern Developer Experience (DX):**
    *   Clear multi-DB configuration via `.env`.
    *   Intuitive and explicit API design using `fastmcp`.
    *   Simple setup, execution, and testing powered by Bun and `fastmcp` tooling.
    *   Safe and readable query construction with `postgres` tagged templates.
*   **🔌 MCP Compliant:** Implements standard MCP concepts (tools, parameters) adapted for multi-DB database interactions.
*   **🧩 Extensible:** Designed to be easily extended with custom database tools or logic.

## 📋 Prerequisites

*   **[Bun](https://bun.sh/) (v1.0 or later recommended):** Ensure Bun is installed and accessible in your PATH.
*   **PostgreSQL Database(s):** Access credentials and network connectivity to one or more PostgreSQL instances.

## ⚙️ Installation

1.  **Clone the repository:**
    ```bash
    # Replace with your actual repository URL
    git clone https://github.com/yourusername/fast-postgres-mcp.git
    cd fast-postgres-mcp
    ```

2.  **Install dependencies:**
    ```bash
    bun install
    ```

## 🔑 Configuration (Multi-Database)

Database connections are configured entirely through environment variables. Bun automatically loads variables from a `.env` file in the project root.

1.  **Create `.env` file:**
    Copy the example configuration:
    ```bash
    cp .env.example .env
    ```

2.  **Edit `.env`:**
    Define connection details for *each* database using a unique alias prefix (`DB_<ALIAS>_`). Also, specify which alias is the default.

    ```dotenv
    # .env - Environment Variables

    # --- REQUIRED: Define Database Aliases ---
    # Comma-separated list of unique aliases used in the variable names below.
    # Example: DB_ALIASES=main,analytics,inventory
    DB_ALIASES=main,reporting

    # --- REQUIRED: Default Database Alias ---
    # Specifies the database to use if a tool call omits the 'dbAlias' parameter.
    # Must be one of the aliases listed in DB_ALIASES.
    DEFAULT_DB_ALIAS=main

    # --- Database Connection Details (Repeat for each alias in DB_ALIASES) ---

    # == Main Application Database (alias: main) ==
    DB_MAIN_HOST=localhost
    DB_MAIN_PORT=5432
    DB_MAIN_NAME=app_prod_db
    DB_MAIN_USER=app_user
    DB_MAIN_PASSWORD=app_secret_password
    DB_MAIN_SSL=disable # Options: disable, require, verify-ca, verify-full (use 'require' or stricter for production)
    # Optional: You can provide a full connection string instead. It overrides the individual parameters above.
    # DB_MAIN_URL=postgres://app_user:app_secret_password@localhost:5432/app_prod_db?sslmode=disable

    # == Reporting Database (alias: reporting) ==
    DB_REPORTING_HOST=reporting-db.read-replica.internal
    DB_REPORTING_PORT=5432
    DB_REPORTING_NAME=analytics_warehouse
    DB_REPORTING_USER=readonly_reporter
    DB_REPORTING_PASSWORD=reporting_db_password
    DB_REPORTING_SSL=require
    # Optional: Connection String override
    # DB_REPORTING_URL=postgres://readonly_reporter:reporting_db_password@reporting-db.read-replica.internal:5432/analytics_warehouse?sslmode=require

    # == Example: Another Database (alias: inventory - if added to DB_ALIASES) ==
    # DB_INVENTORY_URL=postgres://inv_user:inv_pwd@inventory.service:5433/inventory_data?sslmode=disable

    # --- Optional: Server Logging Level ---
    # LOG_LEVEL=info # debug, info, warn, error (defaults to info)
    ```

    *   **Convention:** Variables follow the `DB_<ALIAS>_VARIABLE` pattern (e.g., `DB_MAIN_HOST`, `DB_REPORTING_USER`). The alias (`MAIN`, `REPORTING`) is case-insensitive internally but stick to uppercase for convention.
    *   **Connection String Priority:** If `DB_<ALIAS>_URL` is provided, it takes precedence over individual host/port/user/etc. variables for that alias.
    *   **Validation:** The server will attempt to connect to all databases defined by aliases listed in `DB_ALIASES` during startup. Check the logs for connection success or errors.

## 🚀 Running the Server

*   **Standard Execution:**
    ```bash
    bun run src/index.ts
    ```

*   **Development Mode (with Hot-Reloading):**
    ```bash
    bun run --watch src/index.ts
    ```

    The server will log its startup status, including successful database connections and any errors encountered.

### Testing with `fastmcp` CLI Tools

These tools are invaluable for debugging and interaction:

1.  **Interactive Terminal (`fastmcp dev`):**
    ```bash
    # Requires fastmcp to be installed globally or use bunx
    bunx fastmcp dev src/index.ts
    ```
    This launches `mcp-cli`, allowing you to call tools directly from your terminal. Remember to provide the `dbAlias` parameter if targeting a non-default database.

2.  **Web UI Inspector (`fastmcp inspect`):**
    ```bash
    bunx fastmcp inspect src/index.ts
    ```
    This starts a web server (usually `http://localhost:1111`) providing a graphical interface to inspect server capabilities and test tool calls.

## 🛠️ Available MCP Tools (API Design)

All database interaction tools accept an optional `dbAlias` parameter to specify the target database connection. If omitted, the `DEFAULT_DB_ALIAS` from your `.env` configuration is used.

---

### 1. `query_tool`

Executes a read-only SQL query (typically `SELECT`, but also `SHOW`, `EXPLAIN`, etc.) against the specified database and returns the results. Uses parameterized queries for security.

*   **Description:** Safely execute a read-only SQL query and retrieve results.
*   **Parameters (Zod Schema):**
    *   `statement`: `z.string()` - The SQL query string. Use standard PostgreSQL placeholders like `$1`, `$2`, etc.
    *   `params`: `z.array(z.any()).optional().default([])` - An array of values to substitute for the placeholders in the `statement`. Order matters.
    *   `dbAlias`: `z.string().optional()` - The alias (e.g., `"main"`, `"reporting"`) of the target database connection defined in `.env`. Uses default if omitted.
*   **Execution:** Uses `sql<T>` from the `postgres` driver on the selected connection pool.
*   **Returns:** A JSON string representation of the array of row objects returned by the query. Returns `"[]"` for zero rows.

**Example Request :**
```json
{
  "tool_name": "query_tool",
  "arguments": {
    "statement": "SELECT product_id, name, price FROM products WHERE category = $1 AND price < $2 ORDER BY name LIMIT 10",
    "params": ["electronics", 500],
    "dbAlias": "main"
  }
}
```

**Example Response Content (JSON String):**
```json
"[{\"product_id\":123,\"name\":\"Example Gadget\",\"price\":499.99},{\"product_id\":456,\"name\":\"Another Device\",\"price\":350.00}]"
```

---

### 2. `execute_tool`

Executes a data-modifying SQL statement (`INSERT`, `UPDATE`, `DELETE`, `CREATE TABLE`, `ALTER TABLE`, etc.) against the specified database. Uses parameterized queries for security.

*   **Description:** Safely execute a data-modifying SQL statement.
*   **Parameters (Zod Schema):**
    *   `statement`: `z.string()` - The SQL statement with `$1`, `$2` placeholders.
    *   `params`: `z.array(z.any()).optional().default([])` - Array of values for placeholders.
    *   `dbAlias`: `z.string().optional()` - The alias of the target database connection. Uses default if omitted.
*   **Execution:** Uses `sql` from the `postgres` driver on the selected connection pool.
*   **Returns:** A simple string indicating the number of rows affected by the statement (e.g., `"Rows affected: 1"`). For DDL statements like `CREATE TABLE`, this might be `"Rows affected: 0"`.

**Example Request :**
```json
{
  "tool_name": "execute_tool",
  "arguments": {
    "statement": "UPDATE users SET last_login = NOW() WHERE user_id = $1",
    "params": [54321]
    // dbAlias omitted, uses DEFAULT_DB_ALIAS
  }
}
```

**Example Response Content (String):**
```"Rows affected: 1"
```

---

### 3. `schema_tool`

Retrieves detailed schema information (column names, data types, nullability, defaults) for a specific table from the specified database.

**Example Request :**
```json
{
  "tool_name": "schema_tool",
  "arguments": {
    "tableName": "user_sessions",
    "dbAlias": "main"
  }
}
```

**Example Response Content (JSON String):**
```json
"[{\"column_name\":\"session_id\",\"data_type\":\"uuid\",\"is_nullable\":\"NO\",\"column_default\":\"gen_random_uuid()\"},{\"column_name\":\"user_id\",\"data_type\":\"integer\",\"is_nullable\":\"NO\",\"column_default\":null},{\"column_name\":\"created_at\",\"data_type\":\"timestamp with time zone\",\"is_nullable\":\"YES\",\"column_default\":\"now()\"},{\"column_name\":\"expires_at\",\"data_type\":\"timestamp with time zone\",\"is_nullable\":\"YES\",\"column_default\":null}]"
```

---

### 4. `transaction_tool`

Executes a sequence of SQL statements as a single atomic transaction on the specified database. If any statement fails, the entire transaction is rolled back automatically.


**Example Request :**
```json
{
  "tool_name": "transaction_tool",
  "arguments": {
    "operations": [
      {
        "statement": "INSERT INTO orders (customer_id, order_date, status) VALUES ($1, NOW(), 'pending') RETURNING order_id",
        "params": [101]
        // Note: Simple version doesn't automatically handle passing RETURNING values between operations.
        // More complex workflows might need separate tool calls or enhanced logic.
      },
      {
        "statement": "INSERT INTO order_items (order_id, product_sku, quantity, price) VALUES ($1, $2, $3, $4)",
        "params": [/* placeholder for returned order_id */ 9999, "GADGET-X", 2, 49.99]
      },
      {
        "statement": "UPDATE inventory SET stock_count = stock_count - $1 WHERE product_sku = $2 AND stock_count >= $1",
        "params": [2, "GADGET-X"]
      }
    ],
    "dbAlias": "main"
  }
}
```

**Example Success Response Content (JSON String):**
```json
"{\"success\":true,\"results\":[{\"operation\":0,\"rowsAffected\":1},{\"operation\":1,\"rowsAffected\":1},{\"operation\":2,\"rowsAffected\":1}]}"
```

**Example Error Response Content (JSON String):**
```json
"{\"success\":false,\"error\":\"Error executing operation 2: new row for relation \\\"inventory\\\" violates check constraint \\\"stock_count_non_negative\\\"\",\"failedOperationIndex\":2}"
```

---

## 🔌 Connecting with AI Clients (Cursor, Claude Desktop)

You can integrate this MCP server with AI assistants that allow executing local commands to start MCP servers. The core idea is to tell the AI client how to run your `index.ts` script using `bun`.

**Key Requirement:** You **must** provide the **absolute path** to your `src/index.ts` file in the client configuration. Relative paths often do not work reliably.

### Cursor AI

1.  Open Cursor Settings/Preferences (Cmd+, or Ctrl+,).
2.  Navigate to the "Extensions" -> "MCP" section (or similar, UI might change).
3.  Click "Add MCP Server" or edit the `settings.json` directly.
4.  Configure it using the following structure:

    ```json
    // In Cursor's settings.json or MCP configuration UI
    {
      "mcpServers": {
        // ... other servers ...
        "fast-postgres-mcp": { // A unique name you choose for this server
          "command": "bun",  // Use 'bun' if it's in your PATH
          // Alternatively, provide the full absolute path to your bun executable:
          // "command": "/Users/your_username/.bun/bin/bun",
          "args": [
            "run",
             // *** CRITICAL: Use the ABSOLUTE PATH to your server's entry point ***
            "/Users/your_username/projects/fast-postgres-mcp/src/index.ts"
            // Replace with the actual path on your system
          ],
          "env": {
            // Environment variables specifically for this server *if needed*.
            // Bun automatically loads the .env file from the project directory,
            // so usually you don't need to add DB credentials here.
            // "EXAMPLE_VAR": "cursor_specific_value"
          },
          "enabled": true // Make sure it's enabled
        }
      }
    }
    ```

5.  **Verify:** Restart Cursor or trigger a reload if necessary. Check Cursor's MCP logs/status for connection confirmation.

### Claude Desktop (Anthropic)

1.  **Locate Configuration File:** Find Claude Desktop's configuration file. The location varies by OS:
    *   **macOS:** `~/Library/Application Support/Claude/config.json`
    *   **Windows:** `%APPDATA%\Claude\config.json` (usually `C:\Users\your_username\AppData\Roaming\Claude\config.json`)
    *   **Linux:** `~/.config/Claude/config.json`
2.  **Edit `config.json`:** Add an entry to the `mcpServers` object:

    ```json
    {
      // ... other Claude settings ...
      "mcpServers": {
        // ... potentially other servers ...
        "my_postgres_databases": { // A unique name you choose
          "command": "bun", // Or the full absolute path to bun
          "args": [
            "run",
            // *** CRITICAL: Use the ABSOLUTE PATH to your server's entry point ***
            "/path/to/your/fast-postgres-mcp/src/index.ts"
            // Replace with the actual path on your system
          ],
          "env": {
            // Bun should load .env automatically from the project directory
          },
          "enabled": true
        }
      }
      // ... rest of config ...
    }
    ```

3.  **Restart Claude:** Close and reopen Claude Desktop completely for the changes to take effect.

### Interacting with the AI

Once connected, you can instruct the AI to use your server's tools. Remember to specify the `dbAlias` if you need to target a non-default database:

*   "Using the `query_tool` from `fast-postgres-mcp`, find users with emails ending in '@example.com'." (Uses default DB)
*   "With the `schema_tool` from `my_postgres_databases`, show the columns for the `events` table in the `reporting` database (`dbAlias: \"reporting\"`)."
*   "Execute (`execute_tool`) the following statement on the `main` database (`dbAlias: \"main\"`): `UPDATE settings SET value = 'enabled' WHERE key = 'feature_x'`."

## 🔒 Security Considerations

*   **SQL Injection:** Primarily mitigated by the `postgres` driver's parameterized query handling. **Never** construct SQL queries by directly concatenating external input.
*   **Database Permissions (Critical):** For each database alias defined in `.env`, ensure the corresponding `DB_<ALIAS>_USER` has the **absolute minimum necessary privileges** on that specific database. Avoid using superusers or overly broad roles. Grant permissions granularly (e.g., `SELECT` on specific tables for a reporting user).
*   **SSL/TLS Encryption:** Strongly recommend enabling SSL (`DB_<ALIAS>_SSL=require` or stricter) for all connections, especially those over untrusted networks or to production databases. Ensure your PostgreSQL server is configured to support SSL.
*   **Environment Variables:** Protect your `.env` file. Do not commit it to version control (it should be in your `.gitignore`). Use secure methods for managing secrets in production environments (e.g., Doppler, HashiCorp Vault, cloud provider secret managers).
*   **Server Exposure:** This template runs via `stdio` when invoked by AI clients. If you adapt it to use `fastmcp`'s network transports (SSE/HTTP), implement robust authentication (e.g., `fastmcp`'s `authenticate` hook) and network security (firewalls, TLS for the server itself).
*   **Data Sensitivity:** Be mindful of the data accessible through each database connection. Limit exposure and consider data masking or filtering if necessary, though that's typically handled at the database level.

## 📜 License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details. (You should create a `LICENSE` file containing the MIT license text).
```