.PHONY: dev dev-frontend dev-backend build build-frontend build-backend clean

dev:
	@make -j2 dev-frontend dev-backend

dev-frontend:
	cd web && bun run dev

dev-backend:
	cd backend && go run ./cmd/server

build: build-frontend build-backend

build-frontend:
	cd web && bun run build

build-backend:
	cd backend && go build -o bin/server ./cmd/server

clean:
	rm -rf web/dist backend/bin backend/data
