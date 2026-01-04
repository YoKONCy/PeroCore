
def finish_task(summary: str, status: str = "success"):
    """
    Terminates the current task loop.
    
    Args:
        summary (str): The final response message to the user.
        status (str): "success" or "failure".
    """
    # This function is primarily a marker for the AgentService to intercept.
    # But if executed, it returns a confirmation.
    return f"[System] Task finished with status: {status}. Summary: {summary}"
