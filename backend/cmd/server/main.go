package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

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
	if err := cfg.ValidateStartup(); err != nil {
		log.Fatalf("invalid startup config: %v", err)
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
	channelGroup.GET("/:id/models", channelHandler.ListModels)

	// Settings
	settingsHandler := handler.NewSettingsHandler(db)
	settingsGroup := api.Group("/settings", middleware.AuthRequired(jwtMgr))
	settingsGroup.GET("", settingsHandler.Get)
	settingsGroup.PUT("", settingsHandler.Update)

	// RunningHub
	runningHubHandler := handler.NewRunningHubHandler(db, aesCrypto)
	runningHubGroup := api.Group("/runninghub", middleware.AuthRequired(jwtMgr))
	runningHubGroup.GET("/config", runningHubHandler.GetConfig)
	runningHubGroup.PUT("/config", runningHubHandler.UpdateConfig)

	// ComfyUI
	comfyUIHandler := handler.NewComfyUIHandler(db, aesCrypto)
	comfyUIGroup := api.Group("/comfyui", middleware.AuthRequired(jwtMgr))
	comfyUIGroup.GET("/config", comfyUIHandler.GetConfig)
	comfyUIGroup.PUT("/config", comfyUIHandler.UpdateConfig)

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

	// Projects
	projectHandler := handler.NewCanvasProjectHandler(db)
	projectGroup := api.Group("/projects", middleware.AuthRequired(jwtMgr))
	projectGroup.GET("", projectHandler.List)
	projectGroup.POST("", projectHandler.Create)
	projectGroup.GET("/:projectId", projectHandler.Get)
	projectGroup.PUT("/:projectId", projectHandler.Update)
	projectGroup.DELETE("/:projectId", projectHandler.Delete)

	// Assets
	assetHandler := handler.NewAssetHandler(db)
	assetGroup := api.Group("/assets", middleware.AuthRequired(jwtMgr))
	assetGroup.GET("", assetHandler.List)
	assetGroup.POST("", assetHandler.Create)
	assetGroup.GET("/:assetId", assetHandler.Get)
	assetGroup.PUT("/:assetId", assetHandler.Update)
	assetGroup.DELETE("/:assetId", assetHandler.Delete)

	// Chat (SSE streaming proxy)
	chatHandler := handler.NewChatHandler(db, aesCrypto)
	api.POST("/chat/stream", middleware.AuthRequired(jwtMgr), chatHandler.Stream)

	// WebSocket
	wsHandler := handler.NewWSHandler(hub, jwtMgr)
	api.GET("/ws", wsHandler.Handle)

	// Proxy (prompts aggregator + WebDAV)
	proxyHandler := handler.NewProxyHandler()
	api.GET("/prompts", proxyHandler.Prompts)
	api.POST("/webdav-proxy", middleware.AuthRequired(jwtMgr), proxyHandler.WebDAVProxy)

	// Admin
	adminHandler := handler.NewAdminHandler(db)
	adminGroup := api.Group("/admin", middleware.AuthRequired(jwtMgr), middleware.AdminRequired())
	adminGroup.GET("/audit-logs", adminHandler.ListAuditLogs)
	adminGroup.GET("/users", adminHandler.ListUsers)
	adminGroup.PUT("/users/:id", adminHandler.UpdateUser)

	if staticDir := resolveFrontendDistDir(); staticDir != "" {
		log.Printf("serving frontend from %s", staticDir)
		registerFrontendRoutes(r, staticDir)
	}

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	log.Printf("starting server on %s (db=%s)", addr, cfg.Database.Driver)

	if err := r.Run(addr); err != nil {
		log.Fatalf("server error: %v", err)
		os.Exit(1)
	}
}

func resolveFrontendDistDir() string {
	for _, dir := range []string{"/app/web/dist", "web/dist"} {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
	}
	return ""
}

func registerFrontendRoutes(r *gin.Engine, distDir string) {
	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if path == "/api/v1" || strings.HasPrefix(path, "/api/v1/") {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		serveFrontendAsset(c, distDir)
	})
}

func serveFrontendAsset(c *gin.Context, distDir string) {
	relPath := strings.TrimPrefix(filepath.Clean("/"+c.Request.URL.Path), "/")
	if relPath != "" {
		assetPath := filepath.Join(distDir, relPath)
		if info, err := os.Stat(assetPath); err == nil && !info.IsDir() {
			c.File(assetPath)
			return
		}
	}

	c.File(filepath.Join(distDir, "index.html"))
}
