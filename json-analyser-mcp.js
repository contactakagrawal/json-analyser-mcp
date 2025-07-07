#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from 'stream-chain';
const { chain } = pkg;
import parser from 'stream-json/Parser.js';
import streamArray from 'stream-json/streamers/StreamArray.js';

const server = new McpServer({
  name: "JsonAnalyser",
  version: "1.0.0"
});

// Enhanced read_json tool with better metadata and performance
server.tool(
  "read_json",
  {
    filePath: z.string().describe("Path to the JSON file on disk (.json)"),
    fields: z.array(z.string()).optional().describe("Fields to include in the output. If not specified, all fields are included."),
    detectSchema: z.boolean().optional().default(false).describe("Whether to analyze and return the JSON schema structure")
  },
  async ({ filePath, fields, detectSchema }) => {
    const fs = await import('fs');
    try {
      // Validate file extension
      if (!filePath.endsWith('.json')) {
        return {
          content: [{
            type: "text",
            text: `Only .json files are supported. Provided: ${filePath}`
          }]
        };
      }
      
      // Check if file exists
      try {
        await fs.promises.access(filePath);
      } catch {
        return {
          content: [{
            type: "text",
            text: `File does not exist: ${filePath}`
          }]
        };
      }

      // Get file stats for size information
      const stats = await fs.promises.stat(filePath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      const dataPromise = new Promise((resolve, reject) => {
        const preview = [];
        let totalEntries = 0;
        let fieldNames = [];
        let schemaInfo = {};
        const PREVIEW_LIMIT = 100;

        const pipeline = chain([
            fs.createReadStream(filePath),
            new parser(),
            new streamArray()
        ]);

        pipeline.on('data', ({ value }) => {
            if (totalEntries === 0 && value) {
                fieldNames = Object.keys(value);
                
                // Schema detection
                if (detectSchema) {
                    for (const [key, val] of Object.entries(value)) {
                        schemaInfo[key] = {
                            type: typeof val,
                            sample: val,
                            nullable: false
                        };
                    }
                }
            }
            
            totalEntries++;

            // Update schema info for nullable fields
            if (detectSchema && value) {
                for (const [key, val] of Object.entries(value)) {
                    if (schemaInfo[key] && val === null) {
                        schemaInfo[key].nullable = true;
                    }
                }
            }

            if (preview.length < PREVIEW_LIMIT) {
                let item = value;
                if (fields && fields.length > 0) {
                    const filtered = {};
                    for (const field of fields) {
                        if (item.hasOwnProperty(field)) {
                            filtered[field] = item[field];
                        }
                    }
                    preview.push(filtered);
                } else {
                    preview.push(item);
                }
            }
        });

        pipeline.on('end', () => {
            resolve({ preview, totalEntries, fieldNames, schemaInfo });
        });

        pipeline.on('error', reject);
      });

      const { preview, totalEntries, fieldNames, schemaInfo } = await dataPromise;
      
      const result = {
        "JSON": {
          preview,
          totalEntries,
          fields: fieldNames,
          fileSize: `${fileSizeMB} MB`,
          ...(detectSchema && { schema: schemaInfo }),
          message: `The JSON contains ${totalEntries} entries (${fileSizeMB} MB). A preview of the first ${Math.min(totalEntries, 100)} entries is shown. To access the full dataset, use 'get_json_chunk' for sequential processing or 'query_json' for targeted searches. The 'limit' parameter must not exceed 1000. For example: get_json_chunk(filePath='${filePath}', start=0, limit=1000).`
        }
      };
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Failed to read or parse JSON file: ${error.message}`
        }]
      };
    }
  }
);

// Enhanced query_json tool with multiple operators and case sensitivity
server.tool(
  "query_json",
  {
    filePath: z.string().describe("Path to the JSON file on disk (.json)"),
    query: z.object({
      field: z.string().describe("The field to query (e.g., 'trading_symbol')"),
      operator: z.enum(["contains", "equals", "startsWith", "endsWith", "regex", "gt", "lt", "gte", "lte"]).describe("The query operator"),
      value: z.union([z.string(), z.number()]).describe("The value to match against"),
      caseSensitive: z.boolean().optional().default(false).describe("Whether string comparisons should be case sensitive")
    }).describe("The query to execute on the JSON data"),
    maxResults: z.number().int().positive().optional().default(1000).describe("Maximum number of results to return (default 1000)")
  },
  async ({ filePath, query, maxResults = 1000 }) => {
    const fs = await import('fs');
    try {
      if (!filePath.endsWith('.json')) {
        return { content: [{ type: "text", text: `Only .json files are supported. Provided: ${filePath}` }] };
      }
      
      await fs.promises.access(filePath);

      const dataPromise = new Promise((resolve, reject) => {
        const results = [];
        let totalEntries = 0;
        let matchCount = 0;

        const pipeline = chain([
            fs.createReadStream(filePath),
            new parser(),
            new streamArray()
        ]);

        pipeline.on('data', ({ value }) => {
            totalEntries++;
            let isMatch = false;
            const fieldValue = value[query.field];

            if (fieldValue !== undefined && fieldValue !== null) {
              const strFieldValue = String(fieldValue);
              const queryValue = String(query.value);
              
              // Apply case sensitivity
              const compareValue = query.caseSensitive ? strFieldValue : strFieldValue.toLowerCase();
              const compareQuery = query.caseSensitive ? queryValue : queryValue.toLowerCase();

              switch (query.operator) {
                case 'contains':
                  isMatch = compareValue.includes(compareQuery);
                  break;
                case 'equals':
                  isMatch = compareValue === compareQuery;
                  break;
                case 'startsWith':
                  isMatch = compareValue.startsWith(compareQuery);
                  break;
                case 'endsWith':
                  isMatch = compareValue.endsWith(compareQuery);
                  break;
                case 'regex':
                  try {
                    const regex = new RegExp(queryValue, query.caseSensitive ? 'g' : 'gi');
                    isMatch = regex.test(strFieldValue);
                  } catch (e) {
                    // Invalid regex, skip
                    isMatch = false;
                  }
                  break;
                case 'gt':
                  isMatch = Number(fieldValue) > Number(query.value);
                  break;
                case 'lt':
                  isMatch = Number(fieldValue) < Number(query.value);
                  break;
                case 'gte':
                  isMatch = Number(fieldValue) >= Number(query.value);
                  break;
                case 'lte':
                  isMatch = Number(fieldValue) <= Number(query.value);
                  break;
              }
            }
            
            if (isMatch) {
              matchCount++;
              if (results.length < maxResults) {
                results.push(value);
              }
            }
        });

        pipeline.on('end', () => {
            resolve({ results, totalEntries, matchCount });
        });

        pipeline.on('error', reject);
      });

      const { results, totalEntries, matchCount } = await dataPromise;
      
      let message = `Query found ${matchCount} matching entries out of ${totalEntries} total entries.`;
      if (matchCount > maxResults) {
        message += ` (Results limited to first ${maxResults} matches)`;
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            matches: results,
            matchCount: matchCount,
            totalEntriesScanned: totalEntries,
            queryUsed: query,
            message: message
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Failed to query JSON file: ${error.message}`
        }]
      };
    }
  }
);

// Enhanced get_json_chunk tool with better performance tracking
server.tool(
  "get_json_chunk",
  {
    filePath: z.string().describe("Path to the JSON file on disk (.json)"),
    fields: z.array(z.string()).optional().describe("Fields to include in the output. If not specified, all fields are included."),
    start: z.number().int().nonnegative().default(0).describe("Entry index to start from (0-based)"),
    limit: z.number().int().positive().default(1000).describe("Number of entries to return in the chunk (default 1000)"),
  },
  async ({ filePath, fields, start, limit }) => {
    const fs = await import('fs');
    const startTime = Date.now();
    
    try {
      if (limit > 1000) {
        return {
          content: [{
            type: "text",
            text: `The 'limit' parameter cannot exceed 1000. Please adjust your request. For example, to get the first 1000 entries, use get_json_chunk(filePath='${filePath}', start=0, limit=1000). To get the next 1000 entries, use get_json_chunk(filePath='${filePath}', start=1000, limit=1000).`
          }]
        };
      }
      
      if (!filePath.endsWith('.json')) {
        return {
          content: [{
            type: "text",
            text: `Only .json files are supported. Provided: ${filePath}`
          }]
        };
      }
      
      await fs.promises.access(filePath);
      
      const dataPromise = new Promise((resolve, reject) => {
        const chunk = [];
        let totalEntries = 0;
        let entriesProcessed = 0;

        const pipeline = chain([
            fs.createReadStream(filePath),
            new parser(),
            new streamArray()
        ]);

        pipeline.on('data', ({ key, value }) => {
            totalEntries++;

            if (key >= start && key < start + limit) {
                entriesProcessed++;
                let item = value;
                if (fields && fields.length > 0) {
                    const filtered = {};
                    for (const field of fields) {
                        if (item.hasOwnProperty(field)) {
                            filtered[field] = item[field];
                        }
                    }
                    chunk.push(filtered);
                } else {
                    chunk.push(item);
                }
            }
        });

        pipeline.on('end', () => {
            resolve({ chunk, totalEntries, entriesProcessed });
        });

        pipeline.on('error', reject);
      });

      const { chunk, totalEntries, entriesProcessed } = await dataPromise;
      const processingTime = Date.now() - startTime;
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            chunk,
            start,
            limit,
            entriesReturned: chunk.length,
            totalEntries: totalEntries,
            hasMore: (start + limit) < totalEntries,
            nextStart: (start + limit) < totalEntries ? start + limit : null,
            processingTimeMs: processingTime,
            message: `Retrieved ${chunk.length} entries from position ${start}. ${(start + limit) < totalEntries ? `Use start=${start + limit} for next chunk.` : 'No more entries available.'}`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Failed to read or parse JSON file: ${error.message}`
        }]
      };
    }
  }
);

// New tool: Advanced multi-field query
server.tool(
  "multi_query_json",
  {
    filePath: z.string().describe("Path to the JSON file on disk (.json)"),
    queries: z.array(z.object({
      field: z.string().describe("The field to query"),
      operator: z.enum(["contains", "equals", "startsWith", "endsWith", "regex", "gt", "lt", "gte", "lte"]).describe("The query operator"),
      value: z.union([z.string(), z.number()]).describe("The value to match against"),
      caseSensitive: z.boolean().optional().default(false).describe("Whether string comparisons should be case sensitive")
    })).describe("Array of queries to execute (AND logic)"),
    maxResults: z.number().int().positive().optional().default(1000).describe("Maximum number of results to return (default 1000)")
  },
  async ({ filePath, queries, maxResults = 1000 }) => {
    const fs = await import('fs');
    try {
      if (!filePath.endsWith('.json')) {
        return { content: [{ type: "text", text: `Only .json files are supported. Provided: ${filePath}` }] };
      }
      
      await fs.promises.access(filePath);

      const dataPromise = new Promise((resolve, reject) => {
        const results = [];
        let totalEntries = 0;
        let matchCount = 0;

        const pipeline = chain([
            fs.createReadStream(filePath),
            new parser(),
            new streamArray()
        ]);

        pipeline.on('data', ({ value }) => {
            totalEntries++;
            
            // Check all queries (AND logic)
            const allMatch = queries.every(query => {
              const fieldValue = value[query.field];
              
              if (fieldValue === undefined || fieldValue === null) {
                return false;
              }

              const strFieldValue = String(fieldValue);
              const queryValue = String(query.value);
              
              const compareValue = query.caseSensitive ? strFieldValue : strFieldValue.toLowerCase();
              const compareQuery = query.caseSensitive ? queryValue : queryValue.toLowerCase();

              switch (query.operator) {
                case 'contains':
                  return compareValue.includes(compareQuery);
                case 'equals':
                  return compareValue === compareQuery;
                case 'startsWith':
                  return compareValue.startsWith(compareQuery);
                case 'endsWith':
                  return compareValue.endsWith(compareQuery);
                case 'regex':
                  try {
                    const regex = new RegExp(queryValue, query.caseSensitive ? 'g' : 'gi');
                    return regex.test(strFieldValue);
                  } catch (e) {
                    return false;
                  }
                case 'gt':
                  return Number(fieldValue) > Number(query.value);
                case 'lt':
                  return Number(fieldValue) < Number(query.value);
                case 'gte':
                  return Number(fieldValue) >= Number(query.value);
                case 'lte':
                  return Number(fieldValue) <= Number(query.value);
                default:
                  return false;
              }
            });
            
            if (allMatch) {
              matchCount++;
              if (results.length < maxResults) {
                results.push(value);
              }
            }
        });

        pipeline.on('end', () => {
            resolve({ results, totalEntries, matchCount });
        });

        pipeline.on('error', reject);
      });

      const { results, totalEntries, matchCount } = await dataPromise;
      
      let message = `Multi-query found ${matchCount} matching entries out of ${totalEntries} total entries.`;
      if (matchCount > maxResults) {
        message += ` (Results limited to first ${maxResults} matches)`;
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            matches: results,
            matchCount: matchCount,
            totalEntriesScanned: totalEntries,
            queriesUsed: queries,
            message: message
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Failed to execute multi-query on JSON file: ${error.message}`
        }]
      };
    }
  }
);

// New tool: Get unique values for a field
server.tool(
  "get_unique_values",
  {
    filePath: z.string().describe("Path to the JSON file on disk (.json)"),
    field: z.string().describe("The field to get unique values for"),
    maxValues: z.number().int().positive().optional().default(1000).describe("Maximum number of unique values to return (default 1000)")
  },
  async ({ filePath, field, maxValues = 1000 }) => {
    const fs = await import('fs');
    try {
      if (!filePath.endsWith('.json')) {
        return { content: [{ type: "text", text: `Only .json files are supported. Provided: ${filePath}` }] };
      }
      
      await fs.promises.access(filePath);

      const dataPromise = new Promise((resolve, reject) => {
        const uniqueValues = new Set();
        let totalEntries = 0;
        let nullCount = 0;
        let undefinedCount = 0;

        const pipeline = chain([
            fs.createReadStream(filePath),
            new parser(),
            new streamArray()
        ]);

        pipeline.on('data', ({ value }) => {
            totalEntries++;
            const fieldValue = value[field];
            
            if (fieldValue === null) {
              nullCount++;
            } else if (fieldValue === undefined) {
              undefinedCount++;
            } else if (uniqueValues.size < maxValues) {
              uniqueValues.add(fieldValue);
            }
        });

        pipeline.on('end', () => {
            resolve({ 
              uniqueValues: Array.from(uniqueValues), 
              totalEntries, 
              nullCount, 
              undefinedCount 
            });
        });

        pipeline.on('error', reject);
      });

      const { uniqueValues, totalEntries, nullCount, undefinedCount } = await dataPromise;
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            field: field,
            uniqueValues: uniqueValues,
            uniqueCount: uniqueValues.length,
            totalEntries: totalEntries,
            nullCount: nullCount,
            undefinedCount: undefinedCount,
            message: `Found ${uniqueValues.length} unique values for field '${field}' out of ${totalEntries} entries. ${nullCount > 0 ? `${nullCount} null values. ` : ''}${undefinedCount > 0 ? `${undefinedCount} undefined values.` : ''}`
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Failed to get unique values from JSON file: ${error.message}`
        }]
      };
    }
  }
);

// Exported functions for testing
export async function readJsonFile(filePath, fields, detectSchema = false) {
  const fs = await import('fs');
  try {
    if (!filePath.endsWith('.json')) {
      return {
        content: [{
          type: "text",
          text: `Only .json files are supported. Provided: ${filePath}`
        }]
      };
    }
    
    try {
      await fs.promises.access(filePath);
    } catch {
      return {
        content: [{
          type: "text",
          text: `File does not exist: ${filePath}`
        }]
      };
    }

    const stats = await fs.promises.stat(filePath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    const dataPromise = new Promise((resolve, reject) => {
      const preview = [];
      let totalEntries = 0;
      let fieldNames = [];
      let schemaInfo = {};
      const PREVIEW_LIMIT = 100;

      const pipeline = chain([
          fs.createReadStream(filePath),
          new parser(),
          new streamArray()
      ]);

      pipeline.on('data', ({ value }) => {
          if (totalEntries === 0 && value) {
              fieldNames = Object.keys(value);
              
              if (detectSchema) {
                  for (const [key, val] of Object.entries(value)) {
                      schemaInfo[key] = {
                          type: typeof val,
                          sample: val,
                          nullable: false
                      };
                  }
              }
          }
          
          totalEntries++;

          if (detectSchema && value) {
              for (const [key, val] of Object.entries(value)) {
                  if (schemaInfo[key] && val === null) {
                      schemaInfo[key].nullable = true;
                  }
              }
          }

          if (preview.length < PREVIEW_LIMIT) {
              let item = value;
              if (fields && fields.length > 0) {
                  const filtered = {};
                  for (const field of fields) {
                      if (item.hasOwnProperty(field)) {
                          filtered[field] = item[field];
                      }
                  }
                  preview.push(filtered);
              } else {
                  preview.push(item);
              }
          }
      });

      pipeline.on('end', () => {
          resolve({ preview, totalEntries, fieldNames, schemaInfo });
      });

      pipeline.on('error', reject);
    });

    const { preview, totalEntries, fieldNames, schemaInfo } = await dataPromise;
    
    const result = {
      "JSON": {
        preview,
        totalEntries,
        fields: fieldNames,
        fileSize: `${fileSizeMB} MB`,
        ...(detectSchema && { schema: schemaInfo }),
        message: `The JSON contains ${totalEntries} entries (${fileSizeMB} MB). A preview of the first ${Math.min(totalEntries, 100)} entries is shown.`
      }
    };
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Failed to read or parse JSON file: ${error.message}`
      }]
    };
  }
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error); 