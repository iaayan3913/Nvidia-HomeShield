from .mock import MockScheduler
class CuOptScheduler(MockScheduler):
    """Adapter seam for cuOpt; falls back until the Spark API is verified."""
    pass
