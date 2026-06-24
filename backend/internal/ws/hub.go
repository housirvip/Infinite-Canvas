package ws

import (
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
	maxMsgSize = 4096
)

type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	userID uint
	send   chan []byte
}

func NewClient(hub *Hub, conn *websocket.Conn, userID uint) *Client {
	return &Client{
		hub:    hub,
		conn:   conn,
		userID: userID,
		send:   make(chan []byte, 64),
	}
}

func (c *Client) ReadPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMsgSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		c.hub.handleClientMessage(c, msg)
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

type Hub struct {
	clients    map[uint]map[*Client]struct{}
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[uint]map[*Client]struct{}),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			if h.clients[client.userID] == nil {
				h.clients[client.userID] = make(map[*Client]struct{})
			}
			h.clients[client.userID][client] = struct{}{}
			count := len(h.clients[client.userID])
			h.mu.Unlock()
			log.Printf("ws: registered client (user=%d, total=%d)", client.userID, count)

		case client := <-h.unregister:
			h.mu.Lock()
			if userClients, ok := h.clients[client.userID]; ok {
				delete(userClients, client)
				close(client.send)
				if len(userClients) == 0 {
					delete(h.clients, client.userID)
				}
			}
			h.mu.Unlock()
			log.Printf("ws: unregistered client (user=%d)", client.userID)
		}
	}
}

func (h *Hub) Register(client *Client) {
	h.register <- client
}

func (h *Hub) SendToUser(userID uint, msg *Message) {
	data := msg.JSON()
	h.mu.RLock()
	defer h.mu.RUnlock()

	clients := h.clients[userID]
	for client := range clients {
		select {
		case client.send <- data:
		default:
			log.Printf("ws: dropping message for slow client (user=%d)", userID)
		}
	}
}

func (h *Hub) handleClientMessage(c *Client, raw []byte) {
	var msg Message
	if err := jsonUnmarshal(raw, &msg); err != nil {
		return
	}

	switch msg.Type {
	case MsgTypePing:
		c.send <- (&Message{Type: MsgTypePong}).JSON()
	}
}
