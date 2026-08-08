.PHONY: dev test
dev:
	uvicorn sombra.api:app --host 0.0.0.0 --port 8000 --reload
test:
	python -m pytest tests -q
