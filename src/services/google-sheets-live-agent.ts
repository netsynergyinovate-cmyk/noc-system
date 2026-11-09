import fs from "fs";
import path from "path";
import { google, sheets_v4, drive_v3 } from "googleapis";
import {
  GoogleGenAI,
  Type,
  FunctionDeclaration,
  Content,
  Part,
} from "@google/genai";

export type ThinkingStepType =
  | "thought"
  | "drive_action"
  | "sheets_action"
  | "local_action"
  | "status"
  | "error";

export interface ThinkingTraceEvent {
  timestamp: string;
  stepType: ThinkingStepType;
  toolName?: string;
  title: string;
  detail?: string;
}

export interface NocTaskRow {
  no: number;
  taskId: string;
  moduleName: string;
  featureTitle: string;
  protocolSource: string;
  problemStatement: string;
  technicalSolution: string;
  priority: "P0 (Kritis)" | "P1 (Tinggi)" | "P2 (Sedang)" | "P3 (Rendah)";
  completed: boolean;
}

export type TraceCallback = (event: ThinkingTraceEvent) => void;

interface ThoughtPartLike {
  thought?: boolean;
  text?: string;
}

/**
 * Service Otomasi Google Sheets & Drive API v4
 */
export class GoogleSheetsAutomationService {
  private sheets: sheets_v4.Sheets;
  private drive: drive_v3.Drive;

  constructor() {
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL?.trim();
    const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY?.trim();

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: clientEmail,
        private_key: rawPrivateKey?.replace(/\\n/g, "\n"),
      },
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
      ],
    });

    this.sheets = google.sheets({ version: "v4", auth });
    this.drive = google.drive({ version: "v3", auth });
  }

  private ensureAuth() {
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL?.trim();
    const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY?.trim();

    if (!clientEmail || !rawPrivateKey || rawPrivateKey.includes("...")) {
      throw new Error(
        "Kredensial Google Service Account (GOOGLE_CLIENT_EMAIL & GOOGLE_PRIVATE_KEY) belum diatur di .env.local. Masukkan email dan private key JSON Service Account yang sah.",
      );
    }
  }

  async searchSpreadsheets(queryTitle: string) {
    this.ensureAuth();
    const res = await this.drive.files.list({
      q:
        "mimeType='application/vnd.google-apps.spreadsheet' and name contains '" +
        queryTitle.replace(/'/g, "\\'") +
        "' and trashed=false",
      fields: "files(id, name, webViewLink, modifiedTime)",
      pageSize: 10,
    });
    return res.data.files || [];
  }

  async renameSpreadsheet(spreadsheetId: string, newTitle: string) {
    this.ensureAuth();
    const res = await this.drive.files.update({
      fileId: spreadsheetId,
      requestBody: { name: newTitle },
      fields: "id, name, webViewLink",
    });
    return res.data;
  }

  async readSpreadsheetStructure(spreadsheetId: string, sampleTab?: string) {
    this.ensureAuth();
    const meta = await this.sheets.spreadsheets.get({ spreadsheetId });
    const tabs =
      meta.data.sheets?.map((s) => ({
        sheetId: s.properties?.sheetId,
        title: s.properties?.title,
        rowCount: s.properties?.gridProperties?.rowCount,
        columnCount: s.properties?.gridProperties?.columnCount,
      })) || [];

    let sampleData: string[][] = [];
    const targetTab = sampleTab || tabs[0]?.title;

    if (targetTab) {
      const valuesRes = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "'" + targetTab + "'!A1:I35",
      });
      sampleData = (valuesRes.data.values as string[][]) || [];
    }

    return {
      title: meta.data.properties?.title,
      spreadsheetUrl: meta.data.spreadsheetUrl,
      tabs,
      sampleTab: targetTab,
      sampleData,
    };
  }

  async updateChecklistStatus(
    spreadsheetId: string,
    sheetTitle: string,
    taskId: string,
    completed: boolean,
  ) {
    this.ensureAuth();
    const range = "'" + sheetTitle + "'!B2:I120";
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    const rows = (res.data.values as string[][]) || [];

    const rowIndex = rows.findIndex(
      (row) =>
        row[0]?.toString().trim().toLowerCase() === taskId.trim().toLowerCase(),
    );

    if (rowIndex === -1) {
      throw new Error(
        `Task ID "${taskId}" tidak ditemukan pada tab "${sheetTitle}".`,
      );
    }

    const actualRow = rowIndex + 2;
    const updateRange = "'" + sheetTitle + "'!I" + actualRow;

    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: updateRange,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[completed]],
      },
    });

    return {
      success: true,
      taskId,
      sheetTitle,
      completed,
      updatedRow: actualRow,
    };
  }

  async readLocalDocumentation(section?: string) {
    const docPath = path.join(process.cwd(), "docs", "DOKUMENTASI-APLIKASI.md");
    if (!fs.existsSync(docPath)) {
      return {
        found: false,
        message:
          "Berkas docs/DOKUMENTASI-APLIKASI.md tidak ditemukan di direktori kerja.",
      };
    }

    const fullText = fs.readFileSync(docPath, "utf8");
    if (!section || section.toLowerCase() === "all") {
      return {
        found: true,
        filePath: "docs/DOKUMENTASI-APLIKASI.md",
        summarySnippet: fullText.slice(0, 3500),
        totalCharacters: fullText.length,
      };
    }

    const lines = fullText.split("\n");
    const matched: string[] = [];
    let capture = false;

    for (const line of lines) {
      if (line.toLowerCase().includes(section.toLowerCase())) {
        capture = true;
      } else if (
        capture &&
        line.startsWith("## ") &&
        !line.toLowerCase().includes(section.toLowerCase())
      ) {
        break;
      }

      if (capture) {
        matched.push(line);
        if (matched.length > 80) break;
      }
    }

    return {
      found: true,
      querySection: section,
      content:
        matched.length > 0 ? matched.join("\n") : fullText.slice(0, 3000),
    };
  }

  async upsertFormattedTaskSheet(
    spreadsheetId: string,
    sheetTitle: string,
    tasks: NocTaskRow[],
  ) {
    this.ensureAuth();
    const meta = await this.sheets.spreadsheets.get({ spreadsheetId });
    const existingSheet = meta.data.sheets?.find(
      (s) => s.properties?.title?.toLowerCase() === sheetTitle.toLowerCase(),
    );

    let sheetId = existingSheet?.properties?.sheetId;

    if (sheetId === undefined || sheetId === null) {
      const addSheetRes = await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetTitle,
                  gridProperties: {
                    rowCount: Math.max(tasks.length + 25, 100),
                    columnCount: 9,
                    frozenRowCount: 1,
                  },
                },
              },
            },
          ],
        },
      });
      sheetId =
        addSheetRes.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;
    }

    const headers = [
      "No",
      "ID Task",
      "Modul / Kategori",
      "Fitur & Rincian Tugas Pengembangan",
      "Sumber Perangkat / Protokol",
      "Kondisi / Masalah yang Ditangani",
      "Solusi Teknis & Hasil Diagnostik",
      "Prioritas",
      "Selesai",
    ];

    const values: (string | number | boolean)[][] = [
      headers,
      ...tasks.map((t) => [
        t.no,
        t.taskId,
        t.moduleName,
        t.featureTitle,
        t.protocolSource,
        t.problemStatement,
        t.technicalSolution,
        t.priority,
        t.completed,
      ]),
    ];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "'" + sheetTitle + "'!A1:I" + values.length,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });

    const totalRows = values.length;
    const columnWidths = [50, 110, 200, 260, 210, 300, 340, 110, 85];

    const dimensionRequests: sheets_v4.Schema$Request[] = columnWidths.map(
      (pixelSize, colIdx) => ({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: "COLUMNS",
            startIndex: colIdx,
            endIndex: colIdx + 1,
          },
          properties: { pixelSize },
          fields: "pixelSize",
        },
      }),
    );

    const stylingRequests: sheets_v4.Schema$Request[] = [
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: { frozenRowCount: 1, hideGridlines: false },
          },
          fields: "gridProperties.frozenRowCount,gridProperties.hideGridlines",
        },
      },
      {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 9,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.118, green: 0.161, blue: 0.231 },
              horizontalAlignment: "CENTER",
              verticalAlignment: "MIDDLE",
              wrapStrategy: "WRAP",
              textFormat: {
                bold: true,
                fontSize: 10,
                foregroundColor: { red: 1, green: 1, blue: 1 },
              },
            },
          },
          fields:
            "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
        },
      },
      {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: totalRows,
            startColumnIndex: 0,
            endColumnIndex: 9,
          },
          cell: {
            userEnteredFormat: {
              verticalAlignment: "TOP",
              wrapStrategy: "WRAP",
              textFormat: { fontSize: 10 },
            },
          },
          fields:
            "userEnteredFormat(verticalAlignment,wrapStrategy,textFormat)",
        },
      },
      ...[0, 1, 7, 8].map((colIdx) => ({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: totalRows,
            startColumnIndex: colIdx,
            endColumnIndex: colIdx + 1,
          },
          cell: {
            userEnteredFormat: {
              horizontalAlignment: "CENTER",
              verticalAlignment: "MIDDLE",
            },
          },
          fields: "userEnteredFormat(horizontalAlignment,verticalAlignment)",
        },
      })),
      {
        setDataValidation: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: totalRows,
            startColumnIndex: 8,
            endColumnIndex: 9,
          },
          rule: {
            condition: { type: "BOOLEAN" },
            showCustomUi: true,
            strict: true,
          },
        },
      },
      {
        updateBorders: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: totalRows,
            startColumnIndex: 0,
            endColumnIndex: 9,
          },
          top: {
            style: "SOLID",
            width: 1,
            color: { red: 0.796, green: 0.835, blue: 0.882 },
          },
          bottom: {
            style: "SOLID",
            width: 1,
            color: { red: 0.796, green: 0.835, blue: 0.882 },
          },
          left: {
            style: "SOLID",
            width: 1,
            color: { red: 0.796, green: 0.835, blue: 0.882 },
          },
          right: {
            style: "SOLID",
            width: 1,
            color: { red: 0.796, green: 0.835, blue: 0.882 },
          },
          innerHorizontal: {
            style: "SOLID",
            width: 1,
            color: { red: 0.886, green: 0.91, blue: 0.941 },
          },
          innerVertical: {
            style: "SOLID",
            width: 1,
            color: { red: 0.886, green: 0.91, blue: 0.941 },
          },
        },
      },
    ];

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [...dimensionRequests, ...stylingRequests] },
    });

    return {
      success: true,
      spreadsheetId,
      sheetTitle,
      updatedRows: tasks.length,
      url:
        "https://docs.google.com/spreadsheets/d/" +
        spreadsheetId +
        "/edit#gid=" +
        sheetId,
    };
  }
}

export const sheetsToolDeclarations: FunctionDeclaration[] = [
  {
    name: "search_drive_spreadsheets",
    description:
      "Cari berkas Google Spreadsheet di Google Drive berdasarkan kata kunci judul.",
    parameters: {
      type: Type.OBJECT,
      properties: { queryTitle: { type: Type.STRING } },
      required: ["queryTitle"],
    },
  },
  {
    name: "read_spreadsheet_structure",
    description:
      "Baca daftar tab, jumlah baris/kolom, dan sampel baris dari Google Spreadsheet.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        spreadsheetId: { type: Type.STRING },
        sampleTab: { type: Type.STRING },
      },
      required: ["spreadsheetId"],
    },
  },
  {
    name: "rename_spreadsheet",
    description: "Ubah judul berkas Google Spreadsheet di Google Drive.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        spreadsheetId: { type: Type.STRING },
        newTitle: { type: Type.STRING },
      },
      required: ["spreadsheetId", "newTitle"],
    },
  },
  {
    name: "read_local_documentation",
    description:
      "Periksa dan baca berkas dokumentasi teknis lokal NOC (docs/DOKUMENTASI-APLIKASI.md) untuk mengekstrak modul riil (alert, OLT, mikrotik, netflow, billing, anomali).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        section: {
          type: Type.STRING,
          description:
            "Topik atau modul yang dicari, misal: 'alert', 'anomali', 'mikrotik', 'olt', atau 'all'",
        },
      },
    },
  },
  {
    name: "update_checklist_status",
    description:
      "Perbarui status checklist tugas tertentu (centang atau hapus centang) berdasarkan Task ID unik.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        spreadsheetId: { type: Type.STRING },
        sheetTitle: { type: Type.STRING },
        taskId: {
          type: Type.STRING,
          description: "ID Task (contoh: TASK-ALT-001)",
        },
        completed: {
          type: Type.BOOLEAN,
          description: "True jika tugas selesai, false jika belum",
        },
      },
      required: ["spreadsheetId", "sheetTitle", "taskId", "completed"],
    },
  },
  {
    name: "upsert_formatted_task_sheet",
    description:
      "Buat atau perbarui tab Google Sheet dengan tabel checklist rapi, frozen header biru tua, border, dan kotak centang (checkbox).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        spreadsheetId: { type: Type.STRING },
        sheetTitle: { type: Type.STRING },
        tasks: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              no: { type: Type.INTEGER },
              taskId: { type: Type.STRING },
              moduleName: { type: Type.STRING },
              featureTitle: { type: Type.STRING },
              protocolSource: { type: Type.STRING },
              problemStatement: { type: Type.STRING },
              technicalSolution: { type: Type.STRING },
              priority: {
                type: Type.STRING,
                enum: [
                  "P0 (Kritis)",
                  "P1 (Tinggi)",
                  "P2 (Sedang)",
                  "P3 (Rendah)",
                ],
              },
              completed: { type: Type.BOOLEAN },
            },
            required: [
              "no",
              "taskId",
              "moduleName",
              "featureTitle",
              "protocolSource",
              "problemStatement",
              "technicalSolution",
              "priority",
              "completed",
            ],
          },
        },
      },
      required: ["spreadsheetId", "sheetTitle", "tasks"],
    },
  },
];

export async function runNocSheetsAgentWithThinking(
  userPrompt: string,
  onTrace?: TraceCallback,
) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey.includes("MASUKKAN")) {
    throw new Error(
      "GEMINI_API_KEY belum dikonfigurasi di .env.local. Dapatkan API Key di https://aistudio.google.com/.",
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  const sheetsService = new GoogleSheetsAutomationService();

  const emit = (
    stepType: ThinkingStepType,
    title: string,
    detail?: string,
    toolName?: string,
  ) => {
    if (onTrace) {
      onTrace({
        timestamp: new Date().toISOString(),
        stepType,
        toolName,
        title,
        detail,
      });
    }
  };

  emit(
    "thought",
    "Menganalisis instruksi operasional dan menyiapkan pembaruan Google Sheets.",
  );

  const defaultSpreadsheetId =
    process.env.NOC_SPREADSHEET_ID ||
    "1OVtrQUBpxr_TWdjEQ_91v5mkjTROC8MU497rT10tMG4";

  const contents: Content[] = [{ role: "user", parts: [{ text: userPrompt }] }];

  // Siklus loop pemikiran (reasoning) dan eksekusi tool (maksimal 6 putaran)
  for (let turn = 0; turn < 6; turn++) {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents,
      config: {
        systemInstruction:
          `Anda adalah asisten otomatisasi NOC SYSTEM. Kelola dokumentasi dan checklist pada Spreadsheet ID default: ${defaultSpreadsheetId}. ` +
          "Gunakan tool yang tersedia untuk memeriksa berkas lokal docs/DOKUMENTASI-APLIKASI.md, membaca isi Google Sheet, memperbarui checklist, atau menyusun tabel task terformat rapi.",
        thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 },
        tools: [{ functionDeclarations: sheetsToolDeclarations }],
      },
    });

    const candidate = response.candidates?.[0];
    for (const part of candidate?.content?.parts || []) {
      const partLike = part as unknown as ThoughtPartLike;
      if (partLike.thought && partLike.text) {
        emit("thought", partLike.text.trim());
      }
    }

    if (candidate?.content) {
      contents.push(candidate.content);
    }

    const functionCalls = response.functionCalls || [];
    if (functionCalls.length === 0) {
      emit("status", "Finished thinking");
      return { finalAnswer: response.text || "Operasi selesai dengan sukses." };
    }

    const functionResponses: Part[] = [];
    for (const call of functionCalls) {
      const args = (call.args || {}) as Record<string, unknown>;
      let toolResult: unknown;

      try {
        if (call.name === "search_drive_spreadsheets") {
          const query = String(args.queryTitle || "");
          emit(
            "drive_action",
            `Search Drive: "${query}"`,
            undefined,
            call.name,
          );
          toolResult = await sheetsService.searchSpreadsheets(query);
        } else if (call.name === "read_spreadsheet_structure") {
          const sId = String(args.spreadsheetId || defaultSpreadsheetId);
          const sampleTab = args.sampleTab ? String(args.sampleTab) : undefined;
          emit(
            "drive_action",
            `Read spreadsheet structure (${sId})`,
            undefined,
            call.name,
          );
          toolResult = await sheetsService.readSpreadsheetStructure(
            sId,
            sampleTab,
          );
        } else if (call.name === "rename_spreadsheet") {
          const sId = String(args.spreadsheetId || defaultSpreadsheetId);
          const newTitle = String(args.newTitle || "");
          emit(
            "drive_action",
            `Rename spreadsheet: "${newTitle}"`,
            sId,
            call.name,
          );
          toolResult = await sheetsService.renameSpreadsheet(sId, newTitle);
        } else if (call.name === "read_local_documentation") {
          const section = args.section ? String(args.section) : undefined;
          emit(
            "local_action",
            `Check local working directory files (${section || "all"})`,
            undefined,
            call.name,
          );
          toolResult = await sheetsService.readLocalDocumentation(section);
        } else if (call.name === "update_checklist_status") {
          const sId = String(args.spreadsheetId || defaultSpreadsheetId);
          const sheetTitle = String(args.sheetTitle || "");
          const taskId = String(args.taskId || "");
          const completed = Boolean(args.completed);
          emit(
            "sheets_action",
            `Update checklist: ${taskId} -> ${completed ? "Selesai" : "Belum"}`,
            sId,
            call.name,
          );
          toolResult = await sheetsService.updateChecklistStatus(
            sId,
            sheetTitle,
            taskId,
            completed,
          );
        } else if (call.name === "upsert_formatted_task_sheet") {
          const sId = String(args.spreadsheetId || defaultSpreadsheetId);
          const sheetTitle = String(args.sheetTitle || "");
          const tasks = (args.tasks || []) as NocTaskRow[];
          emit(
            "sheets_action",
            `Update sheet "${sheetTitle}" (${tasks.length} tasks)`,
            sId,
            call.name,
          );
          toolResult = await sheetsService.upsertFormattedTaskSheet(
            sId,
            sheetTitle,
            tasks,
          );
        } else {
          throw new Error(`Tool "${call.name}" tidak terdaftar.`);
        }
      } catch (err: unknown) {
        const errObj = err instanceof Error ? err : new Error(String(err));
        emit(
          "error",
          `Gagal mengeksekusi ${call.name}: ${errObj.message}`,
          undefined,
          call.name,
        );
        toolResult = { error: errObj.message };
      }

      functionResponses.push({
        functionResponse: { name: call.name, response: { result: toolResult } },
      });
    }

    contents.push({ role: "user", parts: functionResponses });
  }

  return { finalAnswer: "Siklus iterasi selesai." };
}
