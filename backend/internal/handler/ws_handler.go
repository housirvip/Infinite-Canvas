package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/infinite-canvas/backend/internal/auth"
	"github.com/infinite-canvas/backend/internal/observability"
	"github.com/infinite-canvas/backend/internal/ws"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type WSHandler struct {
	hub    *ws.Hub
	jwtMgr *auth.JWTManager
}

func NewWSHandler(hub *ws.Hub, jwtMgr *auth.JWTManager) *WSHandler {
	return &WSHandler{hub: hub, jwtMgr: jwtMgr}
}

func (h *WSHandler) Handle(c *gin.Context) {
	token := c.Query("token")
	if token == "" {
		observability.Warn(c.Request.Context(), "ws rejected connection", "reason", "missingToken", "clientIp", c.ClientIP())
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
		return
	}

	claims, err := h.jwtMgr.ValidateToken(token)
	if err != nil {
		observability.Warn(c.Request.Context(), "ws rejected connection", "reason", "invalidToken", "clientIp", c.ClientIP())
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		observability.Error(c.Request.Context(), "ws upgrade failed", "userId", claims.UserID, "clientIp", c.ClientIP(), "error", err)
		return
	}

	observability.Info(c.Request.Context(), "ws connected", "userId", claims.UserID, "clientIp", c.ClientIP())

	client := ws.NewClient(h.hub, conn, claims.UserID)
	h.hub.Register(client)

	go client.WritePump()
	go client.ReadPump()
}
