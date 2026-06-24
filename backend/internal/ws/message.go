package ws

import "encoding/json"

type MessageType string

const (
	MsgTypeTaskStatus    MessageType = "task.status"
	MsgTypeTaskCompleted MessageType = "task.completed"
	MsgTypeTaskFailed    MessageType = "task.failed"
	MsgTypeTaskCancelled MessageType = "task.cancelled"
	MsgTypePing          MessageType = "ping"
	MsgTypePong          MessageType = "pong"
	MsgTypeSubscribe     MessageType = "subscribe"
	MsgTypeError         MessageType = "error"
)

type Message struct {
	Type         MessageType    `json:"type"`
	TaskID       string         `json:"taskId,omitempty"`
	Status       string         `json:"status,omitempty"`
	Progress     int            `json:"progress,omitempty"`
	ProgressText string         `json:"progressText,omitempty"`
	Result       any            `json:"result,omitempty"`
	Error        string         `json:"error,omitempty"`
	TaskIDs      []string       `json:"taskIds,omitempty"`
}

func (m *Message) JSON() []byte {
	data, _ := json.Marshal(m)
	return data
}
