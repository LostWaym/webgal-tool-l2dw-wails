package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAppearancePersistence(t *testing.T) {
	dir := t.TempDir()
	main := &App{configPath: filepath.Join(dir, "L2DW", "config.json")}
	editor := &App{configPath: main.configPath}
	read := func() string {
		got, err := editor.GetAppTheme()
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	if got := read(); got != palettes[0].ID {
		t.Fatalf("missing preference: %q", got)
	}
	for _, p := range palettes {
		if err := main.SetAppTheme(p.ID); err != nil {
			t.Fatal(err)
		}
		if got := read(); got != p.ID {
			t.Fatalf("independent reader: got %q, want %q", got, p.ID)
		}
	}
	if main.SetAppTheme("bad-id") == nil || read() != palettes[len(palettes)-1].ID {
		t.Fatal("invalid write should leave the last successful choice intact")
	}
	if err := os.WriteFile(main.themePath(), []byte("obsolete"), 0600); err != nil {
		t.Fatal(err)
	}
	if read() != palettes[0].ID {
		t.Fatal("unknown stored theme should use the default")
	}
	if _, err := os.Stat(main.configPath); !os.IsNotExist(err) {
		t.Fatal("appearance should not write other preferences")
	}
	// A file where the settings directory should be makes this deterministic even as admin.
	blocked := &App{configPath: filepath.Join(main.themePath(), "config.json")}
	if blocked.SetAppTheme(palettes[0].ID) == nil {
		t.Fatal("I/O failure was reported as success")
	}
}
