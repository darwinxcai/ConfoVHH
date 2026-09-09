# Candidate only: a successful build and GPU/inference receipts are still required.
FROM docker.io/pytorch/pytorch@sha256:2b59b1b91885677814f78be1f8df48a25d5dc952eb6580eaecfefca510f9afd3

# Triton compiles its CUDA launcher at runtime. The runtime base alone does
# not supply a host C compiler. Preserve the resolved OS package inventory;
# apt repository resolution is not an immutable OS-package lock.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends build-essential \
    && mkdir -p /opt/confovhh-runtime \
    && dpkg-query -W -f='${binary:Package}\t${Version}\t${Architecture}\n' > /opt/confovhh-runtime/os-packages.tsv \
    && rm -rf /var/lib/apt/lists/*
ENV CC=/usr/bin/gcc
ENV CXX=/usr/bin/g++

# Use the digest-bound interpreter, with no inherited Python site packages.
RUN /opt/conda/bin/python -c "import sys; assert sys.version_info[:2] == (3, 11), sys.version" \
    && /opt/conda/bin/python -m venv /opt/confovhh-boltz
ENV VIRTUAL_ENV=/opt/confovhh-boltz
ENV PATH=/opt/confovhh-boltz/bin:$PATH
ENV PYTHONNOUSERSITE=1

COPY cloud/boltz-runtime-candidate/bootstrap-linux-py311.lock /opt/confovhh-runtime/bootstrap.lock
COPY cloud/boltz-runtime-candidate/requirements-linux-py311.lock /opt/confovhh-runtime/requirements.lock
RUN python -m pip --isolated install --index-url https://pypi.org/simple \
        --require-hashes --no-deps --no-cache-dir -r /opt/confovhh-runtime/bootstrap.lock \
    && python -m pip --isolated install --index-url https://pypi.org/simple \
        --require-hashes --no-build-isolation --no-cache-dir -r /opt/confovhh-runtime/requirements.lock \
    && python -m pip check

COPY scripts/cloud/check-boltz-runtime.py /opt/confovhh-runtime/check-boltz-runtime.py
COPY scripts/cloud/check-boltz-toolchain.py /opt/confovhh-runtime/check-boltz-toolchain.py
RUN python -I /opt/confovhh-runtime/check-boltz-toolchain.py \
    --compiler-only --output /opt/confovhh-runtime/compiler-build-check
WORKDIR /workspace
CMD ["/bin/bash"]
