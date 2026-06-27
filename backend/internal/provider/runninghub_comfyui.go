package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	gonanoid "github.com/matoous/go-nanoid/v2"

	"github.com/infinite-canvas/backend/internal/model"
	"github.com/infinite-canvas/backend/internal/storage"
)

type RunningHubComfyUIProvider struct {
	pollMs   int
	timeoutS int
}

func NewRunningHubComfyUIProvider(pollMs, timeoutS int) *RunningHubComfyUIProvider {
	if pollMs <= 0 {
		pollMs = 4000
	}
	if timeoutS <= 0 {
		timeoutS = 600
	}
	return &RunningHubComfyUIProvider{pollMs: pollMs, timeoutS: timeoutS}
}

func (p *RunningHubComfyUIProvider) Name() string { return "runninghub_comfyui" }

type rhComfyUIParams struct {
	WorkflowID   string `json:"workflowId"`
	WorkflowJSON string `json:"workflowJson"`
	InstanceType string `json:"instanceType"`
	Timeout      int    `json:"timeout"`
	NodeInfoList []struct {
		NodeID     string `json:"nodeId"`
		FieldName  string `json:"fieldName"`
		FieldValue string `json:"fieldValue"`
	} `json:"nodeInfoList"`
	MediaFileIDs map[string]string `json:"mediaFileIds,omitempty"`
}

func (p *RunningHubComfyUIProvider) Execute(ctx context.Context, task *model.Task, apiKey string, baseURL string,
	fileStore storage.FileStorage, onProgress ProgressFunc) (*ExecuteResult, error) {

	if baseURL == "" {
		baseURL = defaultRunningHubBaseURL
	}

	var params rhComfyUIParams
	if err := json.Unmarshal([]byte(task.Params), &params); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	if params.MediaFileIDs == nil {
		params.MediaFileIDs = make(map[string]string)
	}

	if params.InstanceType == "" {
		params.InstanceType = "default"
	}
	timeout := params.Timeout
	if timeout <= 0 {
		timeout = p.timeoutS
	}

	onProgress(5, "上传媒体文件...")

	for key, fileID := range params.MediaFileIDs {
		data, _, err := fileStore.Load(ctx, fileID)
		if err != nil {
			return nil, fmt.Errorf("failed to load media file %s: %w", fileID, err)
		}

		rhProvider := &RunningHubProvider{}
		uploadURL, err := rhProvider.uploadMedia(ctx, apiKey, baseURL, data)
		if err != nil {
			return nil, fmt.Errorf("failed to upload media: %w", err)
		}

		for i := range params.NodeInfoList {
			nodeKey := params.NodeInfoList[i].NodeID + ":" + params.NodeInfoList[i].FieldName
			if nodeKey == key {
				params.NodeInfoList[i].FieldValue = uploadURL
			}
		}
	}

	onProgress(15, "提交 ComfyUI 工作流...")

	taskID, err := p.submitTask(ctx, apiKey, baseURL, &params)
	if err != nil {
		return nil, err
	}

	task.UpstreamTaskID = taskID

	onProgress(20, "等待执行...")

	rhProvider := &RunningHubProvider{pollMs: p.pollMs, timeoutS: p.timeoutS}
	results, err := rhProvider.pollTask(ctx, apiKey, baseURL, taskID, timeout, onProgress)
	if err != nil {
		return nil, err
	}

	onProgress(85, "下载结果...")

	execResult := &ExecuteResult{UpstreamID: taskID}

	for _, r := range results {
		if isImageOutput(r.OutputType) || isVideoOutput(r.OutputType) || isAudioOutput(r.OutputType) {
			data, err := downloadURL(ctx, r.URL, "")
			if err != nil {
				continue
			}

			mimeType := mimeForExt(r.OutputType)
			fID, _ := gonanoid.New(21)
			url, err := fileStore.Save(ctx, fID, data, mimeType)
			if err != nil {
				continue
			}

			rf := ResultFile{
				FileID:   fID,
				URL:      url,
				MimeType: mimeType,
				Size:     len(data),
			}
			if isImageOutput(r.OutputType) {
				rf.Width, rf.Height = ImageDimensions(data)
			}
			execResult.Files = append(execResult.Files, rf)
		} else if r.Text != "" {
			execResult.Text += r.Text + "\n"
		}
	}

	onProgress(100, "完成")
	return execResult, nil
}

func (p *RunningHubComfyUIProvider) submitTask(ctx context.Context, apiKey, baseURL string, params *rhComfyUIParams) (string, error) {
	body := map[string]any{
		"apiKey": apiKey,
	}

	if params.WorkflowJSON != "" {
		body["workflow"] = params.WorkflowJSON
		if params.WorkflowID != "" {
			body["workflowId"] = params.WorkflowID
		}
	} else if params.WorkflowID != "" {
		body["workflowId"] = params.WorkflowID
	} else {
		return "", fmt.Errorf("either workflowId or workflowJson must be provided")
	}

	if len(params.NodeInfoList) > 0 {
		body["nodeInfoList"] = params.NodeInfoList
	}

	if params.InstanceType != "" && params.InstanceType != "default" {
		body["instanceType"] = params.InstanceType
	}

	jsonData, _ := json.Marshal(body)
	url := strings.TrimSuffix(baseURL, "/") + "/task/openapi/create"

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(jsonData))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	ApplyTraceHeader(ctx, req)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("submit failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	var taskResp struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data *struct {
			TaskID     string `json:"taskId"`
			TaskStatus string `json:"taskStatus"`
			PromptTips string `json:"promptTips"`
		} `json:"data"`
	}

	if err := json.Unmarshal(respBody, &taskResp); err != nil {
		return "", fmt.Errorf("failed to parse response: %s", string(respBody))
	}

	if taskResp.Code != 0 {
		return "", fmt.Errorf("submit failed: %s", taskResp.Msg)
	}

	if taskResp.Data == nil || taskResp.Data.TaskID == "" {
		return "", fmt.Errorf("no taskId in response: %s", string(respBody))
	}

	if taskResp.Data.TaskStatus == "FAILED" {
		tips := taskResp.Data.PromptTips
		if tips == "" {
			tips = "workflow validation failed"
		}
		return "", fmt.Errorf("task failed: %s", tips)
	}

	return taskResp.Data.TaskID, nil
}
