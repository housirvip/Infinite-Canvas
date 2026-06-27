package provider

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"

	gonanoid "github.com/matoous/go-nanoid/v2"

	"github.com/infinite-canvas/backend/internal/model"
	"github.com/infinite-canvas/backend/internal/storage"
)

type OpenAIImageProvider struct{}

func NewOpenAIImageProvider() *OpenAIImageProvider {
	return &OpenAIImageProvider{}
}

func (p *OpenAIImageProvider) Name() string { return "openai_image" }

type imageGenParams struct {
	Model        string   `json:"model"`
	Prompt       string   `json:"prompt"`
	N            int      `json:"n"`
	Quality      string   `json:"quality,omitempty"`
	Size         string   `json:"size,omitempty"`
	SystemPrompt string   `json:"systemPrompt,omitempty"`
	RefFileIDs   []string `json:"refFileIds,omitempty"`
	MaskFileID   string   `json:"maskFileId,omitempty"`
}

type imageAPIResponse struct {
	Data []struct {
		B64JSON string `json:"b64_json"`
		URL     string `json:"url"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func formatImageAPIError(status string, respBody []byte, apiMessage string) error {
	detail := strings.TrimSpace(apiMessage)
	if detail == "" {
		detail = compactResponseBody(respBody)
	}
	if detail == "" {
		return fmt.Errorf("image API request failed (%s)", status)
	}
	return fmt.Errorf("image API request failed (%s): %s", status, detail)
}

func compactResponseBody(body []byte) string {
	text := strings.Join(strings.Fields(strings.TrimSpace(string(body))), " ")
	const maxLen = 300
	if len(text) > maxLen {
		return text[:maxLen] + "..."
	}
	return text
}

func (p *OpenAIImageProvider) Execute(ctx context.Context, task *model.Task, apiKey string, baseURL string,
	fileStore storage.FileStorage, onProgress ProgressFunc) (*ExecuteResult, error) {

	var params imageGenParams
	if err := json.Unmarshal([]byte(task.Params), &params); err != nil {
		return nil, fmt.Errorf("invalid params: %w", err)
	}

	if params.N <= 0 {
		params.N = 1
	}
	if params.Model == "" {
		params.Model = task.Model
	}
	if params.Prompt == "" {
		params.Prompt = task.Prompt
	}

	onProgress(10, "提交图片生成请求...")

	isEdit := task.Type == model.TaskTypeImageEdit && len(params.RefFileIDs) > 0

	var allImages [][]byte
	if isEdit {
		images, err := p.doImageEdit(ctx, apiKey, baseURL, &params, fileStore)
		if err != nil {
			return nil, err
		}
		allImages = images
	} else {
		images, err := p.doImageGeneration(ctx, apiKey, baseURL, &params)
		if err != nil {
			return nil, err
		}
		allImages = images
	}

	onProgress(80, "保存结果...")

	result := &ExecuteResult{}
	for _, imgData := range allImages {
		fileID, _ := gonanoid.New(21)
		url, err := fileStore.Save(ctx, fileID, imgData, "image/png")
		if err != nil {
			return nil, fmt.Errorf("failed to save image: %w", err)
		}
		w, h := ImageDimensions(imgData)
		result.Files = append(result.Files, ResultFile{
			FileID:   fileID,
			URL:      url,
			MimeType: "image/png",
			Size:     len(imgData),
			Width:    w,
			Height:   h,
		})
	}

	onProgress(100, "完成")
	return result, nil
}

func (p *OpenAIImageProvider) doImageGeneration(ctx context.Context, apiKey, baseURL string, params *imageGenParams) ([][]byte, error) {
	body := map[string]any{
		"model":           params.Model,
		"prompt":          params.Prompt,
		"n":               params.N,
		"response_format": "b64_json",
		"output_format":   "png",
	}
	if params.Quality != "" {
		body["quality"] = params.Quality
	}
	if params.Size != "" {
		body["size"] = params.Size
	}

	jsonData, _ := json.Marshal(body)
	url := strings.TrimSuffix(baseURL, "/") + "/images/generations"

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(jsonData))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	var result imageAPIResponse

	parseErr := json.Unmarshal(respBody, &result)
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		apiMessage := ""
		if parseErr == nil && result.Error != nil {
			apiMessage = result.Error.Message
		}
		return nil, formatImageAPIError(resp.Status, respBody, apiMessage)
	}
	if parseErr != nil {
		return nil, fmt.Errorf("failed to parse response (%s): %s", resp.Status, compactResponseBody(respBody))
	}

	if result.Error != nil {
		return nil, formatImageAPIError(resp.Status, respBody, result.Error.Message)
	}

	var images [][]byte
	for _, item := range result.Data {
		if item.B64JSON != "" {
			data, err := base64.StdEncoding.DecodeString(item.B64JSON)
			if err != nil {
				return nil, fmt.Errorf("failed to decode base64: %w", err)
			}
			images = append(images, data)
		} else if item.URL != "" {
			data, err := downloadURL(ctx, item.URL, "")
			if err != nil {
				return nil, fmt.Errorf("failed to download image: %w", err)
			}
			images = append(images, data)
		}
	}

	return images, nil
}

func (p *OpenAIImageProvider) doImageEdit(ctx context.Context, apiKey, baseURL string,
	params *imageGenParams, fileStore storage.FileStorage) ([][]byte, error) {

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)

	w.WriteField("model", params.Model)
	w.WriteField("prompt", params.Prompt)
	w.WriteField("n", fmt.Sprintf("%d", params.N))
	w.WriteField("response_format", "b64_json")
	w.WriteField("output_format", "png")
	if params.Quality != "" {
		w.WriteField("quality", params.Quality)
	}
	if params.Size != "" {
		w.WriteField("size", params.Size)
	}

	for _, fileID := range params.RefFileIDs {
		data, mimeType, err := fileStore.Load(ctx, fileID)
		if err != nil {
			return nil, fmt.Errorf("failed to load ref image %s: %w", fileID, err)
		}
		ext := ".png"
		if strings.Contains(mimeType, "jpeg") || strings.Contains(mimeType, "jpg") {
			ext = ".jpg"
		}
		part, err := w.CreateFormFile("image", "image"+ext)
		if err != nil {
			return nil, err
		}
		part.Write(data)
	}

	if params.MaskFileID != "" {
		data, _, err := fileStore.Load(ctx, params.MaskFileID)
		if err != nil {
			return nil, fmt.Errorf("failed to load mask: %w", err)
		}
		part, err := w.CreateFormFile("mask", "mask.png")
		if err != nil {
			return nil, err
		}
		part.Write(data)
	}

	w.Close()

	url := strings.TrimSuffix(baseURL, "/") + "/images/edits"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	var result imageAPIResponse

	parseErr := json.Unmarshal(respBody, &result)
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		apiMessage := ""
		if parseErr == nil && result.Error != nil {
			apiMessage = result.Error.Message
		}
		return nil, formatImageAPIError(resp.Status, respBody, apiMessage)
	}
	if parseErr != nil {
		return nil, fmt.Errorf("failed to parse response (%s): %s", resp.Status, compactResponseBody(respBody))
	}

	if result.Error != nil {
		return nil, formatImageAPIError(resp.Status, respBody, result.Error.Message)
	}

	var images [][]byte
	for _, item := range result.Data {
		if item.B64JSON != "" {
			data, err := base64.StdEncoding.DecodeString(item.B64JSON)
			if err != nil {
				return nil, fmt.Errorf("failed to decode base64: %w", err)
			}
			images = append(images, data)
		}
	}

	return images, nil
}

func downloadURL(ctx context.Context, url, authHeader string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("download failed (status %d): %s", resp.StatusCode, string(body))
	}
	return io.ReadAll(resp.Body)
}
