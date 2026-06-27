package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infinite-canvas/backend/internal/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type listAuditLogsResponse struct {
	Logs     []model.AuditLog `json:"logs"`
	Total    int64            `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
}

func TestAdminHandlerListAuditLogsFiltersByTraceID(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db, err := gorm.Open(sqlite.Open("file:admin_handler_trace_filter?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.AuditLog{}); err != nil {
		t.Fatalf("automigrate audit logs: %v", err)
	}

	entries := []model.AuditLog{
		{
			TraceID:        "trace-match",
			UserID:         1,
			Username:       "alice",
			Action:         "task.create",
			Resource:       "task",
			ResourceID:     "task-1",
			StatusCode:     http.StatusCreated,
			ResponseTimeMs: 120,
			CreatedAt:      time.Unix(1700000000, 0),
		},
		{
			TraceID:        "trace-other",
			UserID:         2,
			Username:       "bob",
			Action:         "task.create",
			Resource:       "task",
			ResourceID:     "task-2",
			StatusCode:     http.StatusAccepted,
			ResponseTimeMs: 80,
			CreatedAt:      time.Unix(1700000010, 0),
		},
	}
	if err := db.Create(&entries).Error; err != nil {
		t.Fatalf("seed audit logs: %v", err)
	}

	router := gin.New()
	h := NewAdminHandler(db)
	router.GET("/audit-logs", h.ListAuditLogs)

	req := httptest.NewRequest(http.MethodGet, "/audit-logs?traceId=trace-match", nil)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d with body %s", res.Code, res.Body.String())
	}

	var body listAuditLogsResponse
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if body.Total != 1 {
		t.Fatalf("expected total 1, got %d", body.Total)
	}
	if len(body.Logs) != 1 {
		t.Fatalf("expected 1 log, got %d", len(body.Logs))
	}
	if body.Logs[0].TraceID != "trace-match" {
		t.Fatalf("expected matching traceId, got %+v", body.Logs[0])
	}
}
