"""Global logging configuration for the OpenJarvis CLI and server."""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Dict, Optional, Union

from openjarvis.core.paths import get_logs_dir
from openjarvis.security.credential_stripper import CredentialStripper
from openjarvis.security.file_utils import secure_mkdir

_stripper = CredentialStripper()


class SanitizingFormatter(logging.Formatter):
    """Formatter that redacts credentials from log messages."""

    def format(self, record: logging.LogRecord) -> str:
        msg = super().format(record)
        return _stripper.strip(msg)


def setup_logging(
    verbose: bool = False,
    quiet: bool = False,
    log_file: Optional[Union[str, Path]] = None,
    log_to_file: bool = True,
) -> logging.Logger:
    """Configure the ``openjarvis`` logger.

    Parameters
    ----------
    verbose:
        Set log level to DEBUG.
    quiet:
        Set log level to ERROR (overrides verbose if both set).
    log_file:
        Path for a rotating file handler. When omitted, defaults to
        ``<logs_dir>/cli.log``.
    log_to_file:
        Whether to attach rotating file handlers (default True unless quiet).

    Returns
    -------
    The configured ``openjarvis`` logger.
    """
    logger = logging.getLogger("openjarvis")

    # Clear existing handlers to avoid duplication across calls
    logger.handlers.clear()

    if quiet:
        level = logging.ERROR
    elif verbose:
        level = logging.DEBUG
    else:
        level = logging.WARNING

    logger.setLevel(level)

    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(level)
    fmt = SanitizingFormatter("%(levelname)s %(name)s: %(message)s")
    console_handler.setFormatter(fmt)
    logger.addHandler(console_handler)

    # File handler
    if (log_to_file and not quiet) or verbose or log_file is not None:
        logs_dir = get_logs_dir()
        secure_mkdir(logs_dir)
        actual_log_file = (
            Path(log_file) if log_file is not None else (logs_dir / "cli.log")
        )

        file_handler = RotatingFileHandler(
            str(actual_log_file),
            maxBytes=10 * 1024 * 1024,
            backupCount=5,
        )
        file_handler.setLevel(logging.DEBUG if verbose else logging.INFO)
        file_fmt = SanitizingFormatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
        )
        file_handler.setFormatter(file_fmt)
        logger.addHandler(file_handler)

        # Dedicated error file handler for warnings and errors
        if log_file is None:
            error_file = logs_dir / "error.log"
            err_handler = RotatingFileHandler(
                str(error_file),
                maxBytes=10 * 1024 * 1024,
                backupCount=5,
            )
            err_handler.setLevel(logging.WARNING)
            err_handler.setFormatter(file_fmt)
            logger.addHandler(err_handler)

    return logger


def setup_server_logging(
    log_dir: Optional[Union[str, Path]] = None,
    log_level: str = "info",
) -> Dict[str, Path]:
    """Configure dedicated rotating log files for the OpenJarvis API server and uvicorn.

    Writes to:
    - ``<log_dir>/server.log``: full server and access logs
    - ``<log_dir>/error.log``: warnings and errors only

    Returns
    -------
    dict with keys 'server' and 'error' mapping to the respective Path objects.
    """
    logs_dir = Path(log_dir).expanduser().resolve() if log_dir else get_logs_dir()
    secure_mkdir(logs_dir)

    server_log = logs_dir / "server.log"
    error_log = logs_dir / "error.log"

    level = getattr(logging, log_level.upper(), logging.INFO)

    file_fmt = SanitizingFormatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )

    # Server main log handler (info / debug)
    server_handler = RotatingFileHandler(
        str(server_log),
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
    )
    server_handler.setLevel(level)
    server_handler.setFormatter(file_fmt)

    # Error log handler (warning / error / critical)
    error_handler = RotatingFileHandler(
        str(error_log),
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
    )
    error_handler.setLevel(logging.WARNING)
    error_handler.setFormatter(file_fmt)

    # Attach to OpenJarvis and Uvicorn loggers
    target_loggers = [
        logging.getLogger("openjarvis"),
        logging.getLogger("openjarvis.server"),
        logging.getLogger("uvicorn"),
        logging.getLogger("uvicorn.access"),
        logging.getLogger("uvicorn.error"),
    ]

    for log in target_loggers:
        for h in list(log.handlers):
            if isinstance(h, RotatingFileHandler) and h.baseFilename in (
                str(server_log),
                str(error_log),
            ):
                log.removeHandler(h)
                try:
                    h.close()
                except Exception:
                    pass
        log.addHandler(server_handler)
        log.addHandler(error_handler)

    return {"server": server_log, "error": error_log}

