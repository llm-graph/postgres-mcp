# FastPostgresMCP 🐘⚡️ (Full-Featured Multi-DB MCP Server)

**This project implements a blazing fast, type-safe, and full-featured Model Context Protocol (MCP) Server designed for AI Agents (like Cursor, Claude Desktop) to interact with multiple PostgreSQL databases, including listing tables and inspecting schemas.**

It is built with Bun, TypeScript, `postgres`, and leverages advanced features of the `fastmcp` framework for building robust MCP servers.

<a href="https://glama.ai/mcp/servers/@llm-graph/postgres-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@llm-graph/postgres-mcp/badge" alt="FastPostgresMCP MCP server" />
</a>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Powered by fastmcp](https://img.shields.io/badge/Powered%20by-fastmcp-blue)](https://github.com/punkpeye/fastmcp)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-_000)](https://bun.sh)
[![Uses postgres](https://img.shields.io/badge/Uses-postgres-336791)](https://github.com/porsager/postgres)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)](https://www.typescriptlang.org/)
[![GitHub Repository](https://img.shields.io/badge/GitHub-Repository-green)](https://github.com/llm-graph/postgres-mcp)
[![NPM Package](https://img.shields.io/badge/NPM-Package-red)](https://www.npmjs.com/package/postgres-mcp)

## Purpose: An MCP Server for AI Agents

This is **not** a library to be imported into your code. It is a **standalone server application**. You run it as a process, and MCP clients (like AI agents) communicate with it using the JSON-based Model Context Protocol (v2.0), typically over a `stdio` connection managed by the client application (e.g., Cursor).

## Troubleshooting and Development

### Using the CLI for Testing

The package includes a built-in CLI command for testing the MCP server directly:

```bash
# From the project repository:
bun run cli

# This will start an interactive MCP CLI session where you can:
# - Call any of the PostgreSQL tools (query_tool, execute_tool, etc.)
# - View server capabilities
# - Test queries against your configured databases
```

### Testing with Built-in MCP Inspector

You can also use the MCP Inspector to visually test and debug:

```bash
# From the project repository:
bun run inspect
```

### Common Issues

If you see this error when running `bunx postgres-mcp`:
```
FastPostgresMCP started
[warning] FastMCP could not infer client capabilities
```

followed by ping messages, it means:

1. The MCP server started successfully
2. The client connected successfully 
3. But the client is only sending ping requests and not properly negotiating capabilities

This usually indicates you need to use a proper MCP client. Try:
- Using `bun run cli` to test with the MCP CLI
- Configuring the MCP server in Cursor or Claude Desktop as described in the Installation section

If you're developing a custom MCP client, make sure it properly implements the MCP protocol including capabilities negotiation.

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
*   `server.addTool` (for `query_tool`, `execute_tool`, `schema_tool`, and `transaction_tool`)
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

### Option 1: NPM Package

```bash
# Install globally
npm install -g postgres-mcp

# Or install locally in your project
npm install postgres-mcp
```

The npm package is available at [https://www.npmjs.com/package/postgres-mcp](https://www.npmjs.com/package/postgres-mcp)

### Option 2: Clone Repository

1.  **Clone the repository:**
    ```bash
    # Replace with your actual repository URL
    git clone https://github.com/llm-graph/postgres-mcp.git
    cd postgres-mcp
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

# Alternative: Use connection URLs
# DB_MAIN_URL=postgres://user:password@localhost:5432/database?sslmode=require

DB_REPORTING_HOST=reporting-db.read-replica.internal
# ... other reporting DB details ...
DB_REPORTING_USER=readonly_reporter # Needs permissions on information_schema

# --- Optional: Server Logging Level ---
# LOG_LEVEL=info # debug, info, warn, error (defaults to info)
```

## 🚀 Running the Server (as a Process)

Run this server directly using Bun. The AI Client (like Cursor) will typically start and manage this command for you.

### Option 1: Using the globally installed package
*   **To run manually:** `postgres-mcp`

### Option 2: Using the package in your project
*   **To run from your project:** `npx postgres-mcp`
*   **Or import programmatically:**
    ```javascript
    // server.js
    import { startServer } from 'postgres-mcp';
    
    // Start the MCP server
    startServer();
    ```

### Option 3: From cloned repository
*   **To run manually (for testing):** `bun run src/index.ts`
*   **Manual Development Mode:** `bun run --watch src/index.ts`

### Testing with `fastmcp` CLI Tools

*   **Interactive Terminal:** `bunx fastmcp dev src/index.ts`
*   **Web UI Inspector:** `bunx fastmcp inspect src/index.ts`

## 💻 Using the Programmatic API (as a Library)

In addition to running as a standalone MCP server, postgres-mcp can also be used programmatically as a library in your Node.js/TypeScript applications.

### Basic Usage

```typescript
import { createPostgresMcp } from 'postgres-mcp';

// Create the PostgresMcp instance
const postgresMcp = createPostgresMcp();

// Start the server
postgresMcp.start();

// Direct database operations
const results = await postgresMcp.executeQuery(
  'SELECT * FROM users WHERE role = $1',
  ['admin'],
  'main' // optional database alias
);

// When done, stop the server and close connections
await postgresMcp.stop();
```

### Configuration Options

```typescript
const postgresMcp = createPostgresMcp({
  // Custom database configurations (override .env)
  databaseConfigs: {
    main: {
      host: 'localhost',
      port: 5432,
      database: 'app_db',
      user: 'app_user',
      password: 'password',
      ssl: 'disable'
    }
  },
  // Server configuration
  serverConfig: {
    name: 'Custom PostgresMCP',
    defaultDbAlias: 'main'
  },
  // Transport options: 'stdio', 'sse', or 'http'
  transport: 'http',
  port: 3456
});
```

For complete documentation on the programmatic API, see [docs/programmatic-api.md](docs/programmatic-api.md).

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
        "postgres-mcp": { // Unique name for Cursor
          "description": "MCP Server for PostgreSQL DBs (Main, Reporting)",
          "command": "bunx",  // Use 'bun' or provide absolute path: "/Users/your_username/.bun/bin/bun"
          "args": [
            "postgres-mcp"
            // or
            // *** ABSOLUTE PATH to your server's entry point ***
            // "/Users/your_username/projects/postgres-mcp/src/index.ts" /
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
```
"Rows affected: 1"
```

---

#### 3. `schema_tool`

Retrieves detailed schema information for a specific table.

*   **Description:** Get column definitions and details for a database table.
*   **Parameters:** `tableName` (string), `dbAlias` (string, opt).
*   **Context Usage:** `log.info`, access `session`.
*   **Returns:** JSON string array of column information objects.

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

---

#### 4. `transaction_tool`

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
      },
      {
        "statement": "INSERT INTO order_items (order_id, product_sku, quantity, price) VALUES ($1, $2, $3, $4)",
        "params": [9999, "GADGET-X", 2, 49.99]
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

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.

## 📋 Changelog

### 1.0.0
- Initial release
- Full-featured MCP Server for PostgreSQL
- Support for multiple database connections
- Tools for queries, execution, schema inspection, and transactions
- Resources for schema introspection
- Comprehensive documentation and examples