package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed frontend/src/themes/palettes.json
var paletteData []byte

type palette struct {
	ID     string
	Scheme string
	Colors map[string]string
}

var palettes = func() []palette {
	var p []palette
	if err := json.Unmarshal(paletteData, &p); err != nil || len(p) == 0 {
		panic("invalid bundled theme palettes")
	}
	return p
}()

func findPalette(id string) *palette {
	for i := range palettes {
		if palettes[i].ID == id {
			return &palettes[i]
		}
	}
	return nil
}

func (p *palette) nativeWindow() (*options.RGBA, windows.Theme) {
	n, err := strconv.ParseUint(strings.TrimPrefix(p.Colors["window"], "#"), 16, 24)
	if err != nil {
		panic("invalid bundled window colour")
	}
	theme := windows.Dark
	if p.Scheme == "light" {
		theme = windows.Light
	}
	return &options.RGBA{R: uint8(n >> 16), G: uint8(n >> 8), B: uint8(n), A: 255}, theme
}

func (a *App) themePath() string {
	return filepath.Join(filepath.Dir(a.configPath), "appearance")
}

func (a *App) GetAppTheme() (string, error) {
	data, err := os.ReadFile(a.themePath())
	if err != nil && !os.IsNotExist(err) {
		return "", err
	}
	if p := findPalette(strings.TrimSpace(string(data))); p != nil {
		return p.ID, nil
	}
	return palettes[0].ID, nil
}

func (a *App) SetAppTheme(id string) error {
	if findPalette(id) == nil {
		return fmt.Errorf("unknown theme: %q", id)
	}
	path := a.themePath()
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".appearance-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, err = f.WriteString(id + "\n")
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), path)
}

// Watch the directory: the preference is replaced rather than edited in place.
func (a *App) watchAppearance(ctx context.Context) {
	path := a.themePath()
	dir := filepath.Dir(path)
	w, err := fsnotify.NewWatcher()
	if err != nil {
		runtime.LogWarning(ctx, err.Error())
		return
	}
	if err = os.MkdirAll(dir, 0755); err == nil {
		err = w.Add(dir)
	}
	if err != nil {
		w.Close()
		runtime.LogWarning(ctx, err.Error())
		return
	}
	go func() {
		defer w.Close()
		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-w.Events:
				if !ok {
					return
				}
				if event.Name == path {
					runtime.EventsEmit(ctx, "appearance:changed")
				}
			case err, ok := <-w.Errors:
				if !ok {
					return
				}
				runtime.LogWarning(ctx, err.Error())
				runtime.EventsEmit(ctx, "appearance:changed")
			}
		}
	}()
}
