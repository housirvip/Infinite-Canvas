package observability

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infinite-canvas/backend/internal/middleware"
)

func TraceMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		traceID := TraceIDFromRequest(c.Request)
		if traceID == "" {
			traceID = NewTraceID()
		}

		c.Set(ContextKeyTraceID, traceID)
		c.Request = c.Request.WithContext(ContextWithTraceID(c.Request.Context(), traceID))
		c.Header(HeaderTraceID, traceID)

		startedAt := time.Now()
		c.Next()

		attrs := []any{
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"latencyMs", durationMilliseconds(time.Since(startedAt)),
			"clientIp", c.ClientIP(),
			"userAgent", c.Request.UserAgent(),
		}
		if userID, ok := c.Get(middleware.ContextKeyUserID); ok {
			attrs = append(attrs, "userId", userID)
		}

		switch status := c.Writer.Status(); {
		case status >= 500:
			Error(c.Request.Context(), "http request", attrs...)
		case status >= 400:
			Warn(c.Request.Context(), "http request", attrs...)
		default:
			Info(c.Request.Context(), "http request", attrs...)
		}
	}
}
