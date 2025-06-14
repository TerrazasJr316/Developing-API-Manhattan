FROM python:3.10

WORKDIR /app
COPY . /app

RUN apt-get update && apt-get install -y \
    libspatialindex-dev libgeos-dev \
    && pip install --upgrade pip \
    && pip install -r requirements.txt

EXPOSE 5000
CMD ["python", "run.py"]
