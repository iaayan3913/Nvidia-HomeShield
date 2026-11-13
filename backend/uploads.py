"""Private, local upload storage for intake evidence."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from starlette.datastructures import UploadFile

from backend.config import MAX_AUDIO_UPLOAD_BYTES, MAX_PHOTO_UPLOAD_BYTES, UPLOAD_DIRECTORY


class UploadValidationError(ValueError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class StoredUpload:
    reference: str
    path: Path
    kind: str
    mime_type: str
    size: int


_REFERENCE = re.compile(r"^upload://([0-9a-f]{32})\.(jpg|png|webp|wav|mp3|ogg|m4a|webm|flac)$")
_PHOTO_EXTENSIONS = {"jpg", "png", "webp"}
_AUDIO_EXTENSIONS = {"wav", "mp3", "ogg", "m4a", "webm", "flac"}
_MIME_TYPES = {
    "jpg": {"image/jpeg", "image/jpg"},
    "png": {"image/png"},
    "webp": {"image/webp"},
    "wav": {"audio/wav", "audio/x-wav", "audio/wave"},
    "mp3": {"audio/mpeg", "audio/mp3"},
    "ogg": {"audio/ogg", "application/ogg"},
    "m4a": {"audio/mp4", "audio/x-m4a"},
    "webm": {"audio/webm"},
    "flac": {"audio/flac", "audio/x-flac"},
}
_CANONICAL_MIME = {
    "jpg": "image/jpeg", "png": "image/png", "webp": "image/webp",
    "wav": "audio/wav", "mp3": "audio/mpeg", "ogg": "audio/ogg",
    "m4a": "audio/mp4", "webm": "audio/webm", "flac": "audio/flac",
}


def _detected_extension(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "webp"
    if data.startswith(b"RIFF") and data[8:12] == b"WAVE":
        return "wav"
    if data.startswith(b"ID3") or (len(data) >= 2 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0):
        return "mp3"
    if data.startswith(b"OggS"):
        return "ogg"
    if len(data) >= 12 and data[4:8] == b"ftyp":
        return "m4a"
    if data.startswith(b"\x1aE\xdf\xa3"):
        return "webm"
    if data.startswith(b"fLaC"):
        return "flac"
    return None


class UploadStore:
    def __init__(self, directory: str | Path = UPLOAD_DIRECTORY, *,
                 max_photo_bytes: int = MAX_PHOTO_UPLOAD_BYTES,
                 max_audio_bytes: int = MAX_AUDIO_UPLOAD_BYTES):
        self.root = Path(directory).expanduser().resolve()
        self.max_photo_bytes = max_photo_bytes
        self.max_audio_bytes = max_audio_bytes

    async def save(self, upload: UploadFile, kind: str) -> StoredUpload:
        if kind not in {"photo", "audio"}:
            raise UploadValidationError("Unsupported upload kind")
        original = upload.filename or ""
        if not original or ".." in original or "/" in original or "\\" in original:
            raise UploadValidationError("Unsafe upload filename")
        limit = self.max_photo_bytes if kind == "photo" else self.max_audio_bytes
        data = await upload.read(limit + 1)
        if not data:
            raise UploadValidationError("Uploaded file is empty")
        if len(data) > limit:
            raise UploadValidationError(f"{kind} exceeds the configured size limit", status_code=413)

        extension = _detected_extension(data)
        allowed = _PHOTO_EXTENSIONS if kind == "photo" else _AUDIO_EXTENSIONS
        if extension not in allowed:
            raise UploadValidationError(f"File content is not a permitted {kind} format")
        declared = (upload.content_type or "").split(";", 1)[0].strip().lower()
        if declared not in _MIME_TYPES[extension]:
            raise UploadValidationError("Declared media type does not match file content")

        self.root.mkdir(parents=True, exist_ok=True)
        identifier = uuid4().hex
        target = self.root / f"{identifier}.{extension}"
        target.write_bytes(data)
        return StoredUpload(reference=f"upload://{target.name}", path=target, kind=kind,
                            mime_type=_CANONICAL_MIME[extension], size=len(data))

    def resolve(self, reference: str, expected_kind: str | None = None) -> StoredUpload:
        match = _REFERENCE.fullmatch(reference)
        if not match:
            raise UploadValidationError("Invalid upload reference")
        extension = match.group(2)
        kind = "photo" if extension in _PHOTO_EXTENSIONS else "audio"
        if expected_kind and kind != expected_kind:
            raise UploadValidationError("Upload reference has the wrong media kind")
        candidate = (self.root / f"{match.group(1)}.{extension}").resolve()
        if candidate.parent != self.root or not candidate.is_file():
            raise UploadValidationError("Referenced upload does not exist")
        size = candidate.stat().st_size
        limit = self.max_photo_bytes if kind == "photo" else self.max_audio_bytes
        if size <= 0 or size > limit:
            raise UploadValidationError("Stored upload has an invalid size")
        # Revalidate bytes in case a local file was replaced after upload.
        data = candidate.read_bytes()
        if _detected_extension(data) != extension:
            raise UploadValidationError("Stored upload content is invalid")
        return StoredUpload(reference=reference, path=candidate, kind=kind,
                            mime_type=_CANONICAL_MIME[extension], size=size)

    def discard(self, reference: str) -> None:
        try:
            stored = self.resolve(reference)
        except UploadValidationError:
            return
        stored.path.unlink(missing_ok=True)
