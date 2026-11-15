# Optional self-hosted macOS simulator runner

This is a setup guide only. No runner is registered or selected by the current workflows.

## When to add one

First compare its full cost with GitHub-hosted macOS minutes, including hardware, maintenance, disk, Xcode updates and idle time. Keep the hosted runner as the fallback. A self-hosted runner should run only unsigned simulator build or UI-test jobs; signing and TestFlight upload stay on GitHub-hosted runners.

## Safe setup

1. Create a dedicated runner group restricted to the Kinetta repository. Do not make it available to every repository in an organization.
2. Use a disposable macOS host or an ephemeral runner that is rebuilt after each job. Give it a unique label such as `kinetta-simulator`; install only the supported Xcode and simulator runtimes.
3. Give the runner a read-only repository token, no Apple signing keys, no production credentials and no access to other jobs' workspaces or caches. Keep simulator artifacts fictional and short-lived.
4. Route only trusted, same-repository Ready pull requests to this runner. Keep fork pull requests on GitHub-hosted runners (or skip their simulator job). Require both `head.repo.full_name == github.repository` and `pull_request.draft == false` before scheduling any self-hosted job.
5. Never use `pull_request_target` to check out or run pull-request code on the self-hosted runner. Do not download or execute artifacts produced by fork workflows there. A fork can change workflow files and arbitrary scripts, so a label check alone is not a security boundary.
6. Keep the runner group limited to the specific simulator job, test signing disabled, concurrency bounded, and logs/artifacts free of personal data. Remove the runner registration and rebuild the host if it executes unexpected code.

Before enabling it, verify with a fork PR that the self-hosted job is absent and the hosted fallback remains selected. Also confirm a same-repository Draft skips the simulator job, while a same-repository Ready PR runs it. Do not add secrets or change branch protection as part of runner setup.
