import fs from "node:fs";

const files = fs
  .readdirSync(".")
  .filter((f) => f.startsWith("dt-response-") && f.endsWith(".json"));
files.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);

for (const file of files) {
  const content = fs.readFileSync(file, "utf-8");
  try {
    const json = JSON.parse(content);
    console.log(`\n=================== ${file} ===================`);
    console.log(
      `recordsFiltered: ${json.recordsFiltered}, data rows: ${json.data?.length}`,
    );
    if (json.data && json.data.length > 0) {
      console.log("Sample Row Columns (Count:", json.data[0].length, "):");
      json.data[0].forEach((col, idx) => {
        const str = col !== null && col !== undefined ? String(col) : "";
        const text = str
          .replace(/<[^>]+>/g, "")
          .trim()
          .replace(/\s+/g, " ");
        console.log(`  [${idx}] Raw: ${str.slice(0, 80)} | Text: "${text}"`);
      });
    }
  } catch (e) {
    console.log(`Error parsing ${file}:`, e.message);
  }
}
