"""Tests for upload, extraction, and training endpoints."""

import io
from fastapi import FastAPI
from fastapi.testclient import TestClient

from openjarvis.server.upload_router import router


def _create_app():
    app = FastAPI()
    app.include_router(router)
    return app


def test_extract_text_file():
    client = TestClient(_create_app())
    file_bytes = b"Hello OpenJarvis, this is a test document with key instructions."
    files = {"file": ("notes.txt", io.BytesIO(file_bytes), "text/plain")}
    response = client.post("/v1/connectors/upload/extract", files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "notes.txt"
    assert data["ext"] == ".txt"
    assert "Hello OpenJarvis" in data["text"]
    assert data["file_type"] == "text"


def test_extract_python_code_file():
    client = TestClient(_create_app())
    file_bytes = b"def greet(name: str) -> str:\n    return f'Hello {name}'\n"
    files = {"file": ("main.py", io.BytesIO(file_bytes), "text/x-python")}
    response = client.post("/v1/connectors/upload/extract", files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "main.py"
    assert data["ext"] == ".py"
    assert data["file_type"] == "code"
    assert "def greet" in data["text"]


def test_extract_image_file():
    client = TestClient(_create_app())
    # 1x1 PNG image bytes
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\rIDATx\x9cc`\x00\x00\x00"
        b"\x02\x00\x01H\xaf\xa4q\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    files = {"file": ("chart.png", io.BytesIO(png_bytes), "image/png")}
    response = client.post("/v1/connectors/upload/extract", files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "chart.png"
    assert data["ext"] == ".png"
    assert data["file_type"] == "image"
    assert data["base64"] is not None
    assert data["base64"].startswith("data:image/png;base64,")


def test_unsupported_file_extension():
    client = TestClient(_create_app())
    file_bytes = b"binary content"
    files = {"file": ("archive.bin", io.BytesIO(file_bytes), "application/octet-stream")}
    response = client.post("/v1/connectors/upload/extract", files=files)
    assert response.status_code == 400
    assert "Unsupported file type" in response.json()["detail"]


def test_translate_endpoint():
    from openjarvis.server.routes import router as main_router
    app = FastAPI()
    app.include_router(main_router)
    client = TestClient(app)
    response = client.post(
        "/v1/translate",
        json={"text": "Hello, how are you?", "target_language": "Spanish"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["target_language"] == "Spanish"
    assert data["source_language"] == "English"
    assert "translated_text" in data
    assert len(data["translated_text"]) > 0
