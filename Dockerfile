FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=3000

COPY . .
RUN mkdir -p /app/data /app/storage

EXPOSE 3000
CMD ["python", "app.py"]
