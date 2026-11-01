import type { MCPServerConfig } from './contracts';

// Offline fallback mirrors the disabled factory connector templates.
export const MANAGED_CONNECTOR_TEMPLATES: Record<string, MCPServerConfig> = {
  "paddleocr-local": {
    "command": "uvx",
    "args": [
      "--from",
      "paddleocr-mcp[local-cpu]",
      "paddleocr_mcp"
    ],
    "env": {
      "PADDLEOCR_MCP_MODEL": "PP-StructureV3",
      "PADDLEOCR_MCP_PPOCR_SOURCE": "local"
    },
    "enabled": false,
    "source": "external",
    "transport": "stdio",
    "factoryManaged": true,
    "setupUrl": "https://github.com/PaddlePaddle/PaddleOCR",
    "setupHint": "Install uv/uvx, then enable this connector. Its first local CPU run downloads the PP-StructureV3 model.",
    "allowedTools": [
      "pp_structurev3"
    ],
    "allowedPathRoots": [
      "${LUMI_DATA_ROOT}"
    ],
    "allowNetworkUrls": false,
    "description": "Local document-layout and drawing OCR for interior project files.",
    "capabilityDefault": {
      "operation": "observe",
      "risk": "medium",
      "sideEffects": [
        {
          "type": "local_read",
          "scope": "Lumi project data root",
          "reversible": true
        },
        {
          "type": "process_execution",
          "scope": "local PaddleOCR runtime",
          "reversible": true
        }
      ],
      "verification": {
        "strategy": "terminal_receipt",
        "required": true,
        "requiredFields": [],
        "successSignals": [
          "PaddleOCR structured extraction result"
        ],
        "limitations": [
          "OCR text and layout are evidence for review, not verified dimensions or construction geometry."
        ]
      },
      "trust": "third-party",
      "lane": "files"
    }
  },
  "ifc-readonly": {
    "command": "uvx",
    "args": [
      "--from",
      "ifcmcp[mcp]",
      "ifcmcp"
    ],
    "enabled": false,
    "source": "external",
    "transport": "stdio",
    "factoryManaged": true,
    "setupUrl": "https://github.com/IfcOpenShell/IfcOpenShell",
    "setupHint": "Install uv/uvx, keep IFC files in the Lumi project data root, then enable this read-only connector.",
    "allowedTools": [
      "ifc_load",
      "ifc_reset",
      "ifc_summary",
      "ifc_tree",
      "ifc_info",
      "ifc_select",
      "ifc_relations",
      "ifc_clash",
      "ifc_validate",
      "ifc_schema",
      "ifc_contexts",
      "ifc_materials",
      "ifc_plot",
      "ifc_render"
    ],
    "blockedTools": [
      "ifc_new",
      "ifc_save",
      "ifc_shape",
      "ifc_edit",
      "ifc_quantify"
    ],
    "allowedPathRoots": [
      "${LUMI_DATA_ROOT}"
    ],
    "allowNetworkUrls": false,
    "description": "Read-only IFC inspection, validation, clash review, and preview rendering.",
    "capabilityDefault": {
      "operation": "observe",
      "risk": "medium",
      "sideEffects": [
        {
          "type": "local_read",
          "scope": "IFC files under the Lumi project data root",
          "reversible": true
        },
        {
          "type": "process_execution",
          "scope": "local IfcOpenShell runtime",
          "reversible": true
        }
      ],
      "verification": {
        "strategy": "terminal_receipt",
        "required": true,
        "requiredFields": [],
        "successSignals": [
          "IFC query or validation result"
        ],
        "limitations": [
          "The connector cannot save, edit, quantify, or create IFC geometry."
        ]
      },
      "trust": "third-party",
      "lane": "cad"
    }
  },
  "revit-readonly": {
    "command": "rvt-mcp",
    "args": [
      "--read-only",
      "--disable-toolbaker"
    ],
    "env": {
      "BIMWRIGHT_READ_ONLY": "1",
      "BIMWRIGHT_ENABLE_TOOLBAKER": "0",
      "BIMWRIGHT_ENABLE_ADAPTIVE_BAKE": "0"
    },
    "enabled": false,
    "source": "external",
    "transport": "stdio",
    "factoryManaged": true,
    "setupUrl": "https://github.com/bimwright/rvt-mcp",
    "setupHint": "Install the rvt-mcp Revit add-in, start its Revit ribbon connection, then enable this connector. Lumi keeps read-only mode and ToolBaker disabled.",
    "allowedTools": [
      "revit_get_current_view_info",
      "revit_get_selected_elements",
      "revit_ai_element_filter",
      "revit_get_element_details",
      "revit_capture_view_image"
    ],
    "blockedTools": [
      "revit_send_code_to_revit",
      "revit_list_baked_tools",
      "revit_run_baked_tool",
      "revit_list_bake_suggestions"
    ],
    "allowedPathRoots": [
      "${LUMI_DATA_ROOT}"
    ],
    "allowNetworkUrls": false,
    "description": "Local Revit room, view, material, geometry, parameter, and model-audit queries in read-only mode.",
    "capabilityDefault": {
      "operation": "observe",
      "risk": "medium",
      "sideEffects": [
        {
          "type": "local_read",
          "scope": "active Revit model and approved project data",
          "reversible": true
        },
        {
          "type": "process_execution",
          "scope": "local read-only Revit MCP bridge",
          "reversible": true
        }
      ],
      "verification": {
        "strategy": "terminal_receipt",
        "required": true,
        "requiredFields": [],
        "successSignals": [
          "Revit read-only query result"
        ],
        "limitations": [
          "Lumi cannot send arbitrary code, bake tools, or mutate the Revit model through this connector."
        ]
      },
      "trust": "third-party",
      "lane": "cad"
    }
  }
};
