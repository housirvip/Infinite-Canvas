package observability

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestTraceIDFromRequestAcceptsHeader(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(HeaderTraceID, "manual-trace-123")
	req.Header.Set("X-Request-Id", "fallback-trace-456")

	if got := TraceIDFromRequest(req); got != "manual-trace-123" {
		t.Fatalf("expected manual-trace-123, got %q", got)
	}
}

func TestContextWithTraceIDRoundTrip(t *testing.T) {
	base := context.Background()
	if got := TraceIDFromContext(base); got != "" {
		t.Fatalf("expected empty trace id from base context, got %q", got)
	}

	ctx := ContextWithTraceID(base, "trace-ctx-123")
	if got := TraceIDFromContext(ctx); got != "trace-ctx-123" {
		t.Fatalf("expected trace-ctx-123, got %q", got)
	}

	if got := TraceIDFromContext(ContextWithTraceID(base, "")); got != "" {
		t.Fatalf("expected empty trace id for empty input, got %q", got)
	}
}

func TestTraceMiddlewareSetsResponseHeaderAndContext(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(TraceMiddleware())
	router.GET("/trace", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"ginTraceId": TraceIDFromGin(c),
			"ctxTraceId": TraceIDFromContext(c.Request.Context()),
		})
	})

	req := httptest.NewRequest(http.MethodGet, "/trace", nil)
	req.Header.Set(HeaderTraceID, "manual-trace-123")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", res.Code)
	}
	if got := res.Header().Get(HeaderTraceID); got != "manual-trace-123" {
		t.Fatalf("expected response trace header manual-trace-123, got %q", got)
	}

	var body struct {
		GinTraceID string `json:"ginTraceId"`
		CtxTraceID string `json:"ctxTraceId"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.GinTraceID != "manual-trace-123" {
		t.Fatalf("expected gin trace id manual-trace-123, got %q", body.GinTraceID)
	}
	if body.CtxTraceID != "manual-trace-123" {
		t.Fatalf("expected context trace id manual-trace-123, got %q", body.CtxTraceID)
	}
}

func TestTraceMiddlewareGeneratesTraceIDForInvalidIncomingHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.Use(TraceMiddleware())
	router.GET("/trace", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"ginTraceId": TraceIDFromGin(c),
			"ctxTraceId": TraceIDFromContext(c.Request.Context()),
		})
	})

	req := httptest.NewRequest(http.MethodGet, "/trace", nil)
	req.Header.Set(HeaderTraceID, "bad trace")
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	got := res.Header().Get(HeaderTraceID)
	if got == "" {
		t.Fatal("expected generated trace id header, got empty string")
	}
	if got == "bad trace" {
		t.Fatalf("expected invalid incoming trace id to be replaced, got %q", got)
	}
	if !regexp.MustCompile(`^[A-Za-z0-9._:-]{8,128}$`).MatchString(got) {
		t.Fatalf("expected generated trace id to match allowed format, got %q", got)
	}

	var body struct {
		GinTraceID string `json:"ginTraceId"`
		CtxTraceID string `json:"ctxTraceId"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.GinTraceID != got {
		t.Fatalf("expected gin trace id %q, got %q", got, body.GinTraceID)
	}
	if body.CtxTraceID != got {
		t.Fatalf("expected context trace id %q, got %q", got, body.CtxTraceID)
	}
}
