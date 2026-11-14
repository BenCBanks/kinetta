"""Open or update one public issue with recent failed workflows on main."""
from datetime import datetime, timedelta, timezone
import json
import subprocess

MARKER = "<!-- kinetta-main-ci-failure-watch -->"
TITLE = "CI failures on main"


def recent_failures(runs, now=None):
    now = now or datetime.now(timezone.utc)
    newest = {}
    for run in runs:
        created = datetime.fromisoformat(run["createdAt"].replace("Z", "+00:00"))
        if created < now - timedelta(hours=24):
            continue
        name = run.get("workflowName") or run.get("name") or "Unnamed workflow"
        if name not in newest or created > newest[name][0]:
            newest[name] = (created, run)
    return [entry[1] for entry in sorted(newest.values(), key=lambda entry: entry[0], reverse=True)]


def render_body(failures):
    lines = [MARKER, "Automated report of failed workflow runs on `main` from the last 24 hours.", ""]
    lines.extend(f"- **{run.get('workflowName') or run.get('name') or 'Unnamed workflow'}** — [`{run['headSha'][:12]}`]({run['url']})" for run in failures)
    lines.extend(["", "This issue is updated by the scheduled CI watcher; it does not include log contents."])
    return "\n".join(lines)


def gh(*args):
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def main():
    runs = json.loads(gh("run", "list", "--branch", "main", "--status", "failure", "--limit", "1000",
                         "--json", "workflowName,name,createdAt,url,headSha"))
    failures = recent_failures(runs)
    if not failures:
        print("No failed main workflow runs in the last 24 hours.")
        return

    body = render_body(failures)
    issues = json.loads(gh("issue", "list", "--state", "all", "--search", f'in:title "{TITLE}"',
                           "--limit", "100", "--json", "number,title,state,body"))
    matches = [issue for issue in issues if issue["title"] == TITLE and MARKER in issue.get("body", "")]
    issue = next((candidate for candidate in matches if candidate["state"] == "OPEN"), None)
    issue = issue or (matches[0] if matches else None)
    if issue is None:
        gh("issue", "create", "--title", TITLE, "--body", body)
        print("Opened the main CI failure issue.")
        return

    number = str(issue["number"])
    if issue["state"] != "OPEN":
        gh("issue", "reopen", number)
    if issue.get("body") != body:
        gh("issue", "edit", number, "--body", body)
    print(f"Updated main CI failure issue #{number}.")


if __name__ == "__main__":
    main()
