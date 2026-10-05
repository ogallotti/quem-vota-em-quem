# AGENTS.md

As instruções para agentes estão em [`CLAUDE.md`](CLAUDE.md) (o que é, onde roda, como publicar, status e armadilhas). Leia antes de mexer no código ou nos dados.

Resumo: site estático em `public/` (zero build), dados gerados por `scripts/coleta_bu.py` + `scripts/build_data.py`, deploy só via CI (Cloudflare Pages), testes em `tests/` (`pnpm test`, `pnpm smoke`, `pnpm test:mobile`). STATUS: teste.
