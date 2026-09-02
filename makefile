# Local development
# ------------------------------------
build:
	cd src/nuxt && npm i

up:
	cd src/nuxt && npm run dev

up-mock:
	cd src/nuxt && npm run dev:mock

# Cloudflare deployment (see "Deploying" in README.md)
# ------------------------------------
# One-time: create the D1/KV/R2 resources, fill src/nuxt/.env, then `make secrets`.
secrets:
	cd src/nuxt && bash scripts/secrets.sh

# Build, apply D1 migrations, deploy the worker.
deploy:
	cd src/nuxt && bash scripts/deploy.sh

.PHONY: build up up-mock secrets deploy
