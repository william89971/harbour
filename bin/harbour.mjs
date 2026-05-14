#!/usr/bin/env node

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { runAgents } from "./lib/runner.mjs";
import { installRunner, uninstallRunner, statusRunner, isRunnerInstalled } from "./lib/install.mjs";
import {
  listRunners,
  getPollIntervalSeconds,
  saveRunnerInterval,
  MIN_POLL_INTERVAL_SECONDS,
  MAX_POLL_INTERVAL_SECONDS,
} from "./lib/config.mjs";
import { connectAgent } from "./lib/connect.mjs";
import { installBrief, uninstallBrief, briefStatus } from "./lib/brief.mjs";
import { installWeeklyReview, uninstallWeeklyReview, weeklyReviewStatus } from "./lib/weekly-review.mjs";
import { installProductReview, uninstallProductReview, productReviewStatus } from "./lib/product-review.mjs";
import { installGrowthOutreach, uninstallGrowthOutreach, growthOutreachStatus } from "./lib/growth-outreach.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const [,, command, subcommand, ...rest] = process.argv;

function usage() {
  console.log(`
harbour - Control plane for AI agents

Usage:
  harbour start              Start the server (production)
  harbour dev                Start the server (development)
  harbour agent list         List configured harbour agents
  harbour agent run          Poll all harbour agents once
  harbour agent connect <blob>   Register a remote agent (paste the blob from
                                 harbour's "Connect remote runner" panel)
  harbour agent install      Install background polling (macOS launchd / Linux systemd)
  harbour agent uninstall    Remove the background polling install
  harbour agent status       Show install state, timer status, and log commands
  harbour agent interval [N] Show or set the runner polling interval in seconds
                             (range 5..3600, default 60). Re-run install to apply.
  harbour brief install      Install the Daily Founder Brief workflow-only job
                             (requires HARBOUR_ADMIN_API_KEY in env).
  harbour brief uninstall    Remove the brief job and script.
  harbour brief status       Show whether the brief script is installed.
  harbour weekly-review install
                             Install the Weekly Review workflow-only job
                             (requires HARBOUR_ADMIN_API_KEY in env).
  harbour weekly-review uninstall
                             Remove the weekly review job and script.
  harbour weekly-review status
                             Show whether the weekly review script is installed.
  harbour product-review install
                             Install the Product Review Loop built-in workflow
                             (requires HARBOUR_ADMIN_API_KEY in env).
  harbour product-review uninstall
                             Remove the Product Review Loop workflow and agent.
  harbour product-review status
                             Show whether the product-review script is installed.
  harbour growth-outreach install
                             Install the Growth Outreach Loop workflow + agent
                             (requires HARBOUR_ADMIN_API_KEY in env).
  harbour growth-outreach uninstall
                             Remove the Growth Outreach Loop workflow and agent.
  harbour growth-outreach status
                             Show whether the growth-outreach script is installed.
  `.trim());
}

async function main() {
  switch (command) {
    case "start": {
      const child = spawn("npx", ["next", "start", ...rest], { cwd: projectRoot, stdio: "inherit" });
      child.on("exit", (code) => process.exit(code ?? 0));
      break;
    }
    case "dev": {
      const child = spawn("npx", ["next", "dev", ...rest], { cwd: projectRoot, stdio: "inherit" });
      child.on("exit", (code) => process.exit(code ?? 0));
      break;
    }
    case "agent": {
      switch (subcommand) {
        case "list":
          listRunners();
          break;
        case "run":
          await runAgents();
          break;
        case "connect":
          await connectAgent(rest[0]);
          break;
        case "install":
          installRunner();
          break;
        case "uninstall":
          uninstallRunner();
          break;
        case "status":
          statusRunner();
          break;
        case "interval": {
          const arg = rest[0];
          if (arg === undefined) {
            const n = getPollIntervalSeconds();
            console.log(`Runner polling interval: ${n} seconds`);
            console.log(`(stored at ~/.harbour/runner-config.json; run \`agent uninstall && agent install\` to apply changes to the active scheduler)`);
            break;
          }
          const n = parseInt(arg, 10);
          if (!Number.isInteger(n) || n < MIN_POLL_INTERVAL_SECONDS || n > MAX_POLL_INTERVAL_SECONDS) {
            console.error(`Interval must be an integer between ${MIN_POLL_INTERVAL_SECONDS} and ${MAX_POLL_INTERVAL_SECONDS} seconds.`);
            process.exit(1);
          }
          saveRunnerInterval(n);
          console.log(`Runner polling interval set to ${n} seconds.`);
          if (n < 15) {
            console.log(`⚠ Polling more often than every 15s burns more LLM credits and API budget. Make sure that's what you want.`);
          }
          // If a scheduler unit (launchd plist / systemd timer) is already
          // installed, reinstall it so the new interval applies without the
          // user having to run uninstall + install themselves. On platforms
          // where no scheduler is installed (e.g. user manages cron), we
          // just print the saved value — they apply the change themselves.
          if (isRunnerInstalled()) {
            console.log(`Reinstalling scheduler so the new interval takes effect...`);
            uninstallRunner();
            installRunner();
          } else {
            console.log(`Scheduler not installed; the new interval will apply the next time you run \`agent install\`.`);
          }
          break;
        }
        default:
          console.error(`Unknown agent command: ${subcommand}`);
          usage();
          process.exit(1);
      }
      break;
    }
    case "brief": {
      switch (subcommand) {
        case "install":
          await installBrief();
          break;
        case "uninstall":
          await uninstallBrief();
          break;
        case "status":
          briefStatus();
          break;
        default:
          console.error(`Unknown brief command: ${subcommand}`);
          usage();
          process.exit(1);
      }
      break;
    }
    case "weekly-review": {
      switch (subcommand) {
        case "install":
          await installWeeklyReview();
          break;
        case "uninstall":
          await uninstallWeeklyReview();
          break;
        case "status":
          weeklyReviewStatus();
          break;
        default:
          console.error(`Unknown weekly-review command: ${subcommand}`);
          usage();
          process.exit(1);
      }
      break;
    }
    case "product-review": {
      switch (subcommand) {
        case "install":
          await installProductReview();
          break;
        case "uninstall":
          await uninstallProductReview();
          break;
        case "status":
          productReviewStatus();
          break;
        default:
          console.error(`Unknown product-review command: ${subcommand}`);
          usage();
          process.exit(1);
      }
      break;
    }
    case "growth-outreach": {
      switch (subcommand) {
        case "install":
          await installGrowthOutreach();
          break;
        case "uninstall":
          await uninstallGrowthOutreach();
          break;
        case "status":
          growthOutreachStatus();
          break;
        default:
          console.error(`Unknown growth-outreach command: ${subcommand}`);
          usage();
          process.exit(1);
      }
      break;
    }
    default:
      usage();
      break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
