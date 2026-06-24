package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/infinite-canvas/backend/internal/auth"
	"github.com/infinite-canvas/backend/internal/config"
	"github.com/infinite-canvas/backend/internal/crypto"
	"github.com/infinite-canvas/backend/internal/database"
	"github.com/infinite-canvas/backend/internal/handler"
	"github.com/infinite-canvas/backend/internal/middleware"
	"github.com/infinite-canvas/backend/internal/scheduler"
	"github.com/infinite-canvas/backend/internal/storage"
	"github.com/infinite-canvas/backend/internal/ws"
)

func main() {
	configPath := flag.String("config", "config.yaml", "path to config file")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	if cfg.Encryption.MasterKey == "" {
		key := make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			log.Fatalf("failed to generate master key: %v", err)
		}
		cfg.Encryption.MasterKey = hex.EncodeToString(key)
		log.Printf("WARNING: no ENCRYPTION_MASTER_KEY set, using random key (data will be lost on restart)")
	}

	aesCrypto, err := crypto.NewAES(cfg.Encryption.MasterKey)
	if err != nil {
		log.Fatalf("failed to init encryption: %v", err)
	}

	db, err := database.Open(&cfg.Database, cfg.Log.Level)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}

	jwtMgr := auth.NewJWTManager(cfg.Auth.JWTSecret, cfg.Auth.AccessTokenTTL, cfg.Auth.RefreshTokenTTL)

	fileStore, err := storage.NewLocalStorage(cfg.Storage.LocalDir, cfg.Storage.BaseURL)
	if err != nil {
		log.Fatalf("failed to init file storage: %v", err)
	}

	hub := ws.NewHub()
	go hub.Run()

	sched := scheduler.New(db, hub, fileStore, aesCrypto, &cfg.Scheduler)
	sched.Start(context.Background())

	if cfg.Log.Level != "debug" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.Default()
	r.Use(middleware.CORS(cfg.Server.CORS.AllowOrigins))

	api := r.Group("/api/v1")

	api.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Auth
	authHandler := handler.NewAuthHandler(db, jwtMgr)
	authGroup := api.Group("/auth")
	authGroup.POST("/register", authHandler.Register)
	authGroup.POST("/login", authHandler.Login)
	authGroup.POST("/refresh", authHandler.Refresh)
	authGroup.GET("/me", middleware.AuthRequired(jwtMgr), authHandler.Me)

	// Channels
	channelHandler := handler.NewChannelHandler(db, aesCrypto)
	channelGroup := api.Group("/channels", middleware.AuthRequired(jwtMgr))
	channelGroup.GET("", channelHandler.List)
	channelGroup.POST("", channelHandler.Create)
	channelGroup.PUT("/:id", channelHandler.Update)
	channelGroup.DELETE("/:id", channelHandler.Delete)

	// Files
	fileHandler := handler.NewFileHandler(fileStore, cfg.Storage.MaxFileSizeMB)
	fileGroup := api.Group("/files")
	fileGroup.POST("/upload", middleware.AuthRequired(jwtMgr), fileHandler.Upload)
	fileGroup.GET("/:fileId", fileHandler.Download)

	// Tasks
	taskHandler := handler.NewTaskHandler(db, sched)
	taskGroup := api.Group("/tasks", middleware.AuthRequired(jwtMgr))
	taskGroup.POST("", taskHandler.Create)
	taskGroup.GET("", taskHandler.List)
	taskGroup.GET("/:taskId", taskHandler.Get)
	taskGroup.POST("/:taskId/cancel", taskHandler.Cancel)

	// WebSocket
	wsHandler := handler.NewWSHandler(hub, jwtMgr)
	api.GET("/ws", wsHandler.Handle)

	// Admin
	adminHandler := handler.NewAdminHandler(db)
	adminGroup := api.Group("/admin", middleware.AuthRequired(jwtMgr), middleware.AdminRequired())
	adminGroup.GET("/audit-logs", adminHandler.ListAuditLogs)
	adminGroup.GET("/users", adminHandler.ListUsers)
	adminGroup.PUT("/users/:id", adminHandler.UpdateUser)

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	log.Printf("starting server on %s (db=%s)", addr, cfg.Database.Driver)

	if err := r.Run(addr); err != nil {
		log.Fatalf("server error: %v", err)
		os.Exit(1)
	}
}
