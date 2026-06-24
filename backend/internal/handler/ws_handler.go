package handler

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/infinite-canvas/backend/internal/auth"
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
		log.Printf("ws: rejected connection - missing token (ip=%s)", c.ClientIP())
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
		return
	}

	claims, err := h.jwtMgr.ValidateToken(token)
	if err != nil {
		log.Printf("ws: rejected connection - invalid token (ip=%s)", c.ClientIP())
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("ws: upgrade failed (user=%d, ip=%s, err=%v)", claims.UserID, c.ClientIP(), err)
		return
	}

	log.Printf("ws: connected (user=%d, ip=%s)", claims.UserID, c.ClientIP())

	client := ws.NewClient(h.hub, conn, claims.UserID)
	h.hub.Register(client)

	go client.WritePump()
	go client.ReadPump()
}
