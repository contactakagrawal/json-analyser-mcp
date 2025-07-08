# JSON Analyser MCP

A specialized Model Context Protocol (MCP) server for analyzing large JSON files with memory-efficient streaming capabilities.

## Features

- **Memory-Efficient Streaming**: Process gigabyte-sized JSON files without loading them entirely into memory
- **Advanced Querying**: Search JSON data with multiple operators and conditions
- **Schema Detection**: Automatically analyze JSON structure and field types
- **Chunk Processing**: Iterate through large datasets in manageable chunks
- **Multi-Field Queries**: Complex queries with AND logic across multiple fields
- **Unique Value Analysis**: Extract unique values for any field
- **Performance Tracking**: Monitor processing times and memory usage

## Installation

```bash
npm install -g json-analyser-mcp
```

## Usage

### As MCP Server

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "json-analyser": {
      "command": "npx json-analyser-mcp"
    }
  }
}
```

### Available Tools

#### 1. `read_json`
Get an overview and preview of a JSON file.

```javascript
{
  "filePath": "path/to/data.json",
  "fields": ["field1", "field2"], // optional
  "detectSchema": true // optional, analyzes field types
}
```

#### 2. `query_json`
Search for specific data with various operators.

```javascript
{
  "filePath": "path/to/data.json",
  "query": {
    "field": "trading_symbol",
    "operator": "contains", // contains, equals, startsWith, endsWith, regex, gt, lt, gte, lte
    "value": "TITAN",
    "caseSensitive": false // optional
  },
  "maxResults": 1000 // optional
}
```

#### 3. `get_json_chunk`
Process JSON data in sequential chunks.

```javascript
{
  "filePath": "path/to/data.json",
  "fields": ["field1", "field2"], // optional
  "start": 0,
  "limit": 1000
}
```

#### 4. `multi_query_json`
Execute multiple queries with AND logic.

```javascript
{
  "filePath": "path/to/data.json",
  "queries": [
    {
      "field": "category",
      "operator": "equals",
      "value": "technology"
    },
    {
      "field": "price",
      "operator": "gt",
      "value": 100
    }
  ],
  "maxResults": 500
}
```

#### 5. `get_unique_values`
Extract unique values for a specific field.

```javascript
{
  "filePath": "path/to/data.json",
  "field": "category",
  "maxValues": 1000
}
```

## Query Operators

- **contains**: Field value contains the search string
- **equals**: Exact match
- **startsWith**: Field value starts with the search string
- **endsWith**: Field value ends with the search string
- **regex**: Regular expression matching
- **gt**: Greater than (numeric)
- **lt**: Less than (numeric)
- **gte**: Greater than or equal (numeric)
- **lte**: Less than or equal (numeric)

## Performance Benefits

- **Streaming Architecture**: Uses `stream-json` for memory-efficient processing
- **Large File Support**: Can handle multi-gigabyte JSON files
- **Fast Searches**: Optimized for quick data retrieval
- **Minimal Memory Footprint**: Processes data without loading entire files

## Use Cases

- **Data Analysis**: Explore large datasets without memory constraints
- **Log Processing**: Search through application logs efficiently
- **API Response Analysis**: Process large API response files
- **Data Migration**: Extract and transform data from JSON exports
- **Research**: Analyze research datasets and survey responses

## Example Workflows

### Analyzing Trading Data
```javascript
// 1. First, get an overview
read_json({ filePath: "NSE.json", detectSchema: true })

// 2. Search for specific stocks
query_json({
  filePath: "NSE.json",
  query: { field: "trading_symbol", operator: "contains", value: "TITAN" }
})

// 3. Get unique sectors
get_unique_values({ filePath: "NSE.json", field: "sector" })
```

### Processing Support Tickets
```javascript
// 1. Get overview
read_json({ filePath: "tickets.json" })

// 2. Find high-priority open tickets
multi_query_json({
  filePath: "tickets.json",
  queries: [
    { field: "status", operator: "equals", value: "open" },
    { field: "priority", operator: "equals", value: "high" }
  ]
})

// 3. Process all tickets in chunks
get_json_chunk({ filePath: "tickets.json", start: 0, limit: 1000 })
```

## Requirements

- Node.js >= 18.0.0
- Memory: Minimal (streams data)
- Disk: Sufficient space for input JSON files

## License

MIT

## Contributing

Contributions welcome! Please open issues and pull requests on GitHub.

## Support

For issues and questions, please use the GitHub issue tracker. 