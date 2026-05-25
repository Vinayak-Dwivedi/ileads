import { prisma } from "../src/lib/db";
import * as fs from "fs";
import * as path from "path";

async function updateEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    console.log("⚠️ No .env file found at the root folder.");
    return;
  }

  let content = fs.readFileSync(envPath, "utf8");
  const targetModel = 'OPENROUTER_AUDIT_MODEL="google/gemini-2.5-flash"';

  if (content.includes("OPENROUTER_AUDIT_MODEL=")) {
    // Replace the existing model config
    content = content.replace(
      /OPENROUTER_AUDIT_MODEL\s*=\s*["']?[^"\n\r]*["']?/g,
      targetModel
    );
  } else {
    // Append it
    content += `\n\n# LLM Audit Model\n${targetModel}\n`;
  }

  fs.writeFileSync(envPath, content, "utf8");
  console.log("✅ Successfully updated OPENROUTER_AUDIT_MODEL to google/gemini-2.5-flash in .env");
}

async function resetFailedCalls() {
  console.log("Connecting to the database and resetting calls...");
  const res = await prisma.call.updateMany({
    where: {
      processingStatus: { in: ["failed", "transcribing", "auditing"] },
    },
    data: {
      processingStatus: "uploaded",
      processingStartedAt: null,
      processingError: null,
    },
  });
  console.log(`✅ Successfully reset ${res.count} calls back to "uploaded" status.`);
}

async function main() {
  console.log("=== QMS Queue & Audit Fix Script ===");
  try {
    await updateEnvFile();
    await resetFailedCalls();
    console.log("\n🚀 Verification complete. Next steps for the administrator:");
    console.log("1. PM2 Mode:   Run 'pm2 restart all'");
    console.log("2. Docker Mode: Run 'docker compose restart'");
  } catch (err) {
    console.error("❌ Error running fix script:", err);
  }
}

main().finally(() => prisma.$disconnect());
