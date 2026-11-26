package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// 环境变量按原样使用；默认路径相对于可执行文件，无法定位时相对于工作目录。
func resourceDir(env, relative string) string {
	if v := os.Getenv(env); v != "" {
		return v
	}
	if exe, err := os.Executable(); err == nil {
		return filepath.Join(filepath.Dir(exe), relative)
	}
	return relative
}

func listResourceFiles(dir, suffix string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	names := []string{}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), suffix) {
			names = append(names, entry.Name())
		}
	}
	return names, nil
}

func validateResourceFilename(operation, filename string) error {
	if filename == "" {
		return fmt.Errorf("%s: filename is empty", operation)
	}
	if strings.ContainsAny(filename, `/\`) || strings.Contains(filename, "..") {
		return fmt.Errorf("%s: invalid filename %q", operation, filename)
	}
	return nil
}

func readResourceFile(operation, dir, filename string) (string, error) {
	if err := validateResourceFilename(operation, filename); err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(dir, filename))
	if err != nil {
		return "", err
	}
	return string(data), nil
}
