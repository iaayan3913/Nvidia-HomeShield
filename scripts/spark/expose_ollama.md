# Expose Ollama

Preferred: use an SSH tunnel from Windows PowerShell:

```powershell
ssh -N -L 11434:localhost:11434 user@<spark-ip>
```

If venue policy permits LAN access, add an Ollama systemd override with `OLLAMA_HOST=0.0.0.0`, reload/restart the service, and verify with `curl http://<spark-ip>:11434/v1/models`. `VERIFY:` confirm the service name and policy before changing it.
