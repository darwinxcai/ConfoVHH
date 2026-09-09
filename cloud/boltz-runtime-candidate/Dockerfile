# Candidate only: a successful build and GPU/inference receipts are still required.
FROM docker.io/pytorch/pytorch@sha256:2b59b1b91885677814f78be1f8df48a25d5dc952eb6580eaecfefca510f9afd3

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
WORKDIR /workspace
CMD ["/bin/bash"]
