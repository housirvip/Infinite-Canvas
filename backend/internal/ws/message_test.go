package ws

import (
	"strings"
	"testing"
)

func TestMessageJSONIncludesTraceID(t *testing.T) {
	msg := &Message{Type: MsgTypeTaskStatus, TaskID: "t1", TraceID: "trace-123"}

	got := string(msg.JSON())
	if !strings.Contains(got, `"traceId":"trace-123"`) {
		t.Fatalf("expected traceId in JSON, got %s", got)
	}
}
