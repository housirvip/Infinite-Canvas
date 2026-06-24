.PHONY: build run dev clean

build:
	go build -o bin/server ./cmd/server

run: build
	./bin/server

dev:
	go run ./cmd/server

clean:
	rm -rf bin/ data/

tidy:
	go mod tidy
