FROM postgres:18.4-bookworm

ARG PGVECTOR_VERSION=0.8.6
ARG PGVECTOR_REVISION=8ee86c96f0fd72390f890aa8a336fda6d3ab4c6c
ARG PG_MAJOR=18

ADD https://github.com/pgvector/pgvector.git#${PGVECTOR_REVISION} /tmp/pgvector

RUN apt-get update \
    && apt-mark hold locales \
    && apt-get install -y --no-install-recommends build-essential postgresql-server-dev-${PG_MAJOR} \
    && make -C /tmp/pgvector clean \
    && make -C /tmp/pgvector OPTFLAGS="" \
    && make -C /tmp/pgvector install \
    && test "$(sed -n "s/^default_version = '\(.*\)'/\1/p" /usr/share/postgresql/${PG_MAJOR}/extension/vector.control)" = "${PGVECTOR_VERSION}" \
    && rm -rf /tmp/pgvector \
    && apt-get remove -y build-essential postgresql-server-dev-${PG_MAJOR} \
    && apt-get autoremove -y \
    && apt-mark unhold locales \
    && rm -rf /var/lib/apt/lists/*
