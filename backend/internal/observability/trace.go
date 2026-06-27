package observability

import (
	"context"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	gonanoid "github.com/matoous/go-nanoid/v2"
)

const HeaderTraceID = "X-Trace-Id"
const ContextKeyTraceID = "traceId"

type traceIDContextKey string

const contextTraceIDKey traceIDContextKey = ContextKeyTraceID

var traceIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{8,128}$`)

func NewTraceID() string {
	traceID, err := gonanoid.New(21)
	if err == nil {
		return traceID
	}
	return strconv.FormatInt(time.Now().UnixNano(), 36)
}

func TraceIDFromGin(c *gin.Context) string {
	if c == nil {
		return ""
	}
	value, ok := c.Get(ContextKeyTraceID)
	if !ok {
		return ""
	}
	traceID, ok := value.(string)
	if !ok {
		return ""
	}
	return traceID
}

func TraceIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	traceID, _ := ctx.Value(contextTraceIDKey).(string)
	return traceID
}

func ContextWithTraceID(ctx context.Context, traceID string) context.Context {
	if traceID == "" {
		return ctx
	}
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, contextTraceIDKey, traceID)
}

func TraceIDFromRequest(r *http.Request) string {
	if r == nil {
		return ""
	}
	for _, header := range []string{HeaderTraceID, "X-Request-Id", "X-Correlation-Id"} {
		traceID := strings.TrimSpace(r.Header.Get(header))
		if traceID == "" {
			continue
		}
		if traceIDPattern.MatchString(traceID) {
			return traceID
		}
		return ""
	}
	return ""
}
