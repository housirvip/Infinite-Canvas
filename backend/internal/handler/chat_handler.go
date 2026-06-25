package handler

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infinite-canvas/backend/internal/crypto"
	"github.com/infinite-canvas/backend/internal/middleware"
	"github.com/infinite-canvas/backend/internal/model"
	"gorm.io/gorm"
)

type ChatHandler struct {
	db     *gorm.DB
	crypto *crypto.AESCrypto
}

func NewChatHandler(db *gorm.DB, aesCrypto *crypto.AESCrypto) *ChatHandler {
	return &ChatHandler{db: db, crypto: aesCrypto}
}

func (h *ChatHandler) Stream(c *gin.Context) {
	startTime := time.Now()
	userID := middleware.GetUserID(c)

	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read request body"})
		return
	}

	channelIDStr := c.Query("channelId")
	apiFormat := c.Query("apiFormat")
	modelName := c.Query("model")

	var channel model.ApiChannel
	if channelIDStr != "" {
		if err := h.db.Where("id = ? AND user_id = ?", channelIDStr, userID).First(&channel).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "channel not found"})
			return
		}
	} else {
		if err := h.db.Where("user_id = ? AND enabled = ?", userID, true).First(&channel).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "no channel configured"})
			return
		}
	}

	apiKey, err := h.crypto.Decrypt(channel.EncryptedAPIKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to decrypt API key"})
		return
	}

	if apiFormat == "" {
		apiFormat = channel.APIFormat
	}
	if apiFormat == "" || apiFormat == "openai" {
		apiFormat = "openai-completion"
	}

	var upstreamURL string
	switch apiFormat {
	case "gemini":
		if modelName == "" {
			modelName = "gemini-2.0-flash"
		}
		baseURL := channel.BaseURL
		if baseURL == "" {
			baseURL = "https://generativelanguage.googleapis.com"
		}
		upstreamURL = fmt.Sprintf("%s/v1beta/models/%s:streamGenerateContent?alt=sse", baseURL, modelName)
	case "anthropic":
		baseURL := channel.BaseURL
		if baseURL == "" {
			baseURL = "https://api.anthropic.com"
		}
		upstreamURL = strings.TrimRight(baseURL, "/") + "/v1/messages"
	case "openai-response":
		baseURL := normalizeBaseURL(channel.BaseURL)
		upstreamURL = baseURL + "/responses"
	default:
		baseURL := normalizeBaseURL(channel.BaseURL)
		upstreamURL = baseURL + "/chat/completions"
	}

	upstreamReq, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, upstreamURL, io.NopCloser(io.NewSectionReader(newByteReader(bodyBytes), 0, int64(len(bodyBytes)))))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create upstream request"})
		return
	}

	upstreamReq.Header.Set("Content-Type", "application/json")
	switch apiFormat {
	case "gemini":
		upstreamReq.Header.Set("x-goog-api-key", apiKey)
	case "anthropic":
		upstreamReq.Header.Set("anthropic-version", "2023-06-01")
		if strings.Contains(upstreamURL, "anthropic.com") {
			upstreamReq.Header.Set("x-api-key", apiKey)
		} else {
			upstreamReq.Header.Set("Authorization", "Bearer "+apiKey)
		}
	default:
		upstreamReq.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := http.DefaultClient.Do(upstreamReq)
	if err != nil {
		h.recordChatAudit(userID, modelName, &channel, apiFormat, http.StatusBadGateway, startTime, c.ClientIP())
		c.JSON(http.StatusBadGateway, gin.H{"error": "upstream request failed"})
		return
	}
	defer resp.Body.Close()

	c.Writer.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.WriteHeader(resp.StatusCode)
	c.Writer.Flush()

	buf := make([]byte, 4096)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			c.Writer.Write(buf[:n])
			c.Writer.Flush()
		}
		if readErr != nil {
			break
		}
	}

	h.recordChatAudit(userID, modelName, &channel, apiFormat, resp.StatusCode, startTime, c.ClientIP())
}

func (h *ChatHandler) recordChatAudit(userID uint, modelName string, channel *model.ApiChannel, apiFormat string, statusCode int, startTime time.Time, ip string) {
	writeAuditLog(h.db, &model.AuditLog{
		UserID:         userID,
		Action:         "chat_stream",
		Resource:       "chat",
		Model:          modelName,
		ChannelID:      channel.ID,
		ChannelName:    channel.Name,
		APIFormat:      apiFormat,
		StatusCode:     statusCode,
		ResponseTimeMs: time.Since(startTime).Milliseconds(),
		IP:             ip,
	})
}

func normalizeBaseURL(baseURL string) string {
	if baseURL == "" {
		return "https://api.openai.com/v1"
	}
	if len(baseURL) > 0 && baseURL[len(baseURL)-1] == '/' {
		baseURL = baseURL[:len(baseURL)-1]
	}
	if len(baseURL) < 3 || baseURL[len(baseURL)-3:] != "/v1" {
		baseURL += "/v1"
	}
	return baseURL
}

type byteReaderAt struct {
	data []byte
}

func newByteReader(data []byte) *byteReaderAt {
	return &byteReaderAt{data: data}
}

func (b *byteReaderAt) ReadAt(p []byte, off int64) (int, error) {
	if off >= int64(len(b.data)) {
		return 0, io.EOF
	}
	n := copy(p, b.data[off:])
	if off+int64(n) >= int64(len(b.data)) {
		return n, io.EOF
	}
	return n, nil
}
