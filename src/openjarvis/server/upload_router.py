"""Upload / Paste router for ingesting documents into the knowledge store."""

from __future__ import annotations

import io
import logging
import uuid
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from openjarvis.connectors.store import KnowledgeStore
from openjarvis.core.config import DEFAULT_CONFIG_DIR

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/connectors/upload", tags=["upload"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TEXT_EXTENSIONS = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".log",
    ".json", ".yaml", ".yml", ".xml", ".html", ".css",
    ".js", ".ts", ".tsx", ".jsx", ".py", ".rs", ".go",
    ".java", ".c", ".cpp", ".h", ".hpp", ".sql", ".sh",
    ".bash", ".toml", ".ini", ".env", ".rtf",
}
_DOC_EXTENSIONS = {".pdf", ".docx"}
_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
_ALLOWED_EXTENSIONS = _TEXT_EXTENSIONS | _DOC_EXTENSIONS | _IMAGE_EXTENSIONS


def _chunk_text(text: str, max_chars: int = 1000) -> List[str]:
    """Split *text* into ~max_chars pieces at paragraph boundaries."""
    paragraphs = text.split("\n\n")
    chunks: List[str] = []
    current = ""
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if current and len(current) + len(para) + 2 > max_chars:
            chunks.append(current.strip())
            current = para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current.strip():
        chunks.append(current.strip())
    # Guard against very large paragraphs that exceed max_chars
    final: List[str] = []
    for chunk in chunks:
        while len(chunk) > max_chars:
            # Find last space within limit
            split_at = chunk.rfind(" ", 0, max_chars)
            if split_at == -1:
                split_at = max_chars
            final.append(chunk[:split_at].strip())
            chunk = chunk[split_at:].strip()
        if chunk:
            final.append(chunk)
    return final


def _extract_text_from_pdf(data: bytes) -> str:
    """Extract text from a PDF using pdfplumber, pypdf, or PyPDF2."""
    # Try pdfplumber first
    try:
        import pdfplumber  # type: ignore[import-untyped]

        with pdfplumber.open(io.BytesIO(data)) as pdf:
            pages = [p.extract_text() or "" for p in pdf.pages]
        return "\n\n".join(pages)
    except ImportError:
        pass

    # Try pypdf next
    try:
        from pypdf import PdfReader  # type: ignore[import-untyped]

        reader = PdfReader(io.BytesIO(data))
        pages = [p.extract_text() or "" for p in reader.pages]
        return "\n\n".join(pages)
    except ImportError:
        pass

    # Fall back to PyPDF2
    try:
        from PyPDF2 import PdfReader  # type: ignore[import-untyped]

        reader = PdfReader(io.BytesIO(data))
        pages = [p.extract_text() or "" for p in reader.pages]
        return "\n\n".join(pages)
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail=(
                "PDF parsing requires pypdf or pdfplumber. "
                "Install with: pip install pypdf"
            ),
        )


def _extract_text_from_docx(data: bytes) -> str:
    """Extract text from a .docx file using python-docx."""
    try:
        from docx import Document  # type: ignore[import-untyped]

        doc = Document(io.BytesIO(data))
        return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail=(
                "DOCX parsing requires python-docx. "
                "Install with: pip install python-docx"
            ),
        )


def _extract_image_info(data: bytes, filename: str) -> str:
    """Extract metadata / description / OCR from an image."""
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(data))
        width, height = img.size
        img_format = img.format or "Image"
        mode = img.mode

        ocr_text = ""
        try:
            import pytesseract  # type: ignore[import-untyped]
            ocr_text = pytesseract.image_to_string(img).strip()
        except Exception:
            pass

        desc = (
            f"Image file: {filename} "
            f"({width}x{height} px, format {img_format}, mode {mode}, {len(data) // 1024} KB)."
        )
        if ocr_text:
            desc += f"\nExtracted Text (OCR):\n{ocr_text}"
        return desc
    except Exception as exc:
        logger.debug("Failed to extract image metadata: %s", exc)
        return f"Image file: {filename} ({len(data) // 1024} KB visual asset)."


def _get_store() -> KnowledgeStore:
    """Return a KnowledgeStore pointing at the default knowledge DB."""
    db_path = DEFAULT_CONFIG_DIR / "knowledge.db"
    return KnowledgeStore(db_path=db_path)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class PasteRequest(BaseModel):
    title: str = ""
    content: str


class IngestResponse(BaseModel):
    chunks_added: int
    source: str = "upload"


class ExtractResponse(BaseModel):
    filename: str
    ext: str
    size: int
    file_type: str
    text: str
    preview: str
    base64: Optional[str] = None
    chunks_count: int = 1


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/extract", response_model=ExtractResponse)
async def extract_file(file: UploadFile = File(...)) -> ExtractResponse:
    """Extract text and metadata from an uploaded file for chat reading and preview."""
    import base64

    filename = file.filename or "untitled"
    ext = ""
    if "." in filename:
        ext = "." + filename.rsplit(".", 1)[-1].lower()

    if ext not in _ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(_ALLOWED_EXTENSIONS))
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Allowed: {allowed}",
        )

    data = await file.read()
    size = len(data)
    base64_data: Optional[str] = None

    if ext in _IMAGE_EXTENSIONS:
        file_type = "image"
        text = _extract_image_info(data, filename)
        mime = "image/png" if ext == ".png" else "image/webp" if ext == ".webp" else "image/jpeg"
        base64_str = base64.b64encode(data).decode("utf-8")
        base64_data = f"data:{mime};base64,{base64_str}"
    elif ext == ".pdf":
        file_type = "document"
        text = _extract_text_from_pdf(data)
    elif ext == ".docx":
        file_type = "document"
        text = _extract_text_from_docx(data)
    elif ext in {".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".json", ".sql", ".sh", ".rs", ".go", ".c", ".cpp", ".java"}:
        file_type = "code"
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = data.decode("latin-1", errors="replace")
    else:
        file_type = "text"
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = data.decode("latin-1", errors="replace")

    chunks = _chunk_text(text) if text else []
    preview = text[:300].strip()
    if len(text) > 300:
        preview += "..."

    return ExtractResponse(
        filename=filename,
        ext=ext,
        size=size,
        file_type=file_type,
        text=text,
        preview=preview,
        base64=base64_data,
        chunks_count=max(len(chunks), 1),
    )


@router.post("/ingest", response_model=IngestResponse)
async def ingest_paste(body: PasteRequest) -> IngestResponse:
    """Ingest pasted text into the knowledge store."""
    text = body.content.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Content is empty")

    store = _get_store()
    doc_id = str(uuid.uuid4())
    chunks = _chunk_text(text)

    for idx, chunk in enumerate(chunks):
        store.store(
            chunk,
            source="upload",
            doc_type="paste",
            doc_id=doc_id,
            title=body.title or "Pasted text",
            chunk_index=idx,
        )

    logger.info("Ingested %d chunks from pasted text (doc_id=%s)", len(chunks), doc_id)
    return IngestResponse(chunks_added=len(chunks))


@router.post("/ingest/files", response_model=IngestResponse)
async def ingest_files(
    files: List[UploadFile] = File(...),
    title: Optional[str] = Form(None),
) -> IngestResponse:
    """Ingest uploaded files into the knowledge store."""
    store = _get_store()
    total_chunks = 0

    for upload in files:
        filename = upload.filename or "untitled"
        ext = ""
        if "." in filename:
            ext = "." + filename.rsplit(".", 1)[-1].lower()

        if ext not in _ALLOWED_EXTENSIONS:
            allowed = ", ".join(sorted(_ALLOWED_EXTENSIONS))
            raise HTTPException(
                status_code=400,
                detail=(f"Unsupported file type: {ext}. Allowed: {allowed}"),
            )

        data = await upload.read()

        # Parse content based on extension
        if ext in _TEXT_EXTENSIONS:
            try:
                text = data.decode("utf-8")
            except UnicodeDecodeError:
                text = data.decode("latin-1", errors="replace")
        elif ext == ".pdf":
            text = _extract_text_from_pdf(data)
        elif ext == ".docx":
            text = _extract_text_from_docx(data)
        elif ext in _IMAGE_EXTENSIONS:
            text = _extract_image_info(data, filename)
        else:
            continue

        text = text.strip()
        if not text:
            continue

        doc_id = str(uuid.uuid4())
        doc_title = title or filename
        chunks = _chunk_text(text)

        for idx, chunk in enumerate(chunks):
            store.store(
                chunk,
                source="upload",
                doc_type=ext.lstrip("."),
                doc_id=doc_id,
                title=doc_title,
                chunk_index=idx,
            )

        total_chunks += len(chunks)
        logger.info(
            "Ingested %d chunks from file %s (doc_id=%s)",
            len(chunks),
            filename,
            doc_id,
        )

    return IngestResponse(chunks_added=total_chunks)

