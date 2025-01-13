import matplotlib.pyplot as plt
import numpy as np
from scipy.interpolate import splprep, splev


def draw_on_plot(x_lim, y_max):
    fig, ax = plt.subplots()
    ax.set_title("Draw on the plot and zoom with the mouse wheel")
    ax.set_xlim(-x_lim, x_lim)
    ax.set_ylim(0, y_max)

    # Arrays to store x and y coordinates of the drawn path
    x_coords, y_coords = [], []

    # Flag to check if drawing mode is active
    drawing = False

    def on_mouse_press(event):
        nonlocal drawing
        if event.button == 1:  # Left mouse button
            drawing = True
            x_coords.clear()
            y_coords.clear()
            x_coords.append(event.xdata)
            y_coords.append(event.ydata)

    def on_mouse_release(event):
        nonlocal drawing
        if event.button == 1:  # Left mouse button
            drawing = False

    def on_mouse_move(event):
        if drawing and event.xdata is not None and event.ydata is not None:
            # Update the coordinates and plot line as the mouse moves
            x_coords.append(event.xdata)
            y_coords.append(event.ydata)
            ax.plot(x_coords[-2:], y_coords[-2:], color='blue')
            plt.draw()

    def on_scroll(event):
        scale_factor = 1.1 if event.button == 'up' else 0.9
        xlim, ylim = ax.get_xlim(), ax.get_ylim()
        x_center, y_center = (xlim[0] + xlim[1]) / 2, (ylim[0] + ylim[1]) / 2
        x_range, y_range = (xlim[1] - xlim[0]) * scale_factor, (ylim[1] - ylim[0]) * scale_factor

        # Update limits while maintaining the fixed axis bounds
        new_xlim = max(-x_lim, x_center - x_range / 2), min(x_lim, x_center + x_range / 2)
        new_ylim = max(0, y_center - y_range / 2), min(y_max, y_center + y_range / 2)

        ax.set_xlim(new_xlim)
        ax.set_ylim(new_ylim)
        plt.draw()

    # Connect the events to their functions
    fig.canvas.mpl_connect('button_press_event', on_mouse_press)
    fig.canvas.mpl_connect('button_release_event', on_mouse_release)
    fig.canvas.mpl_connect('motion_notify_event', on_mouse_move)
    fig.canvas.mpl_connect('scroll_event', on_scroll)

    plt.show()

    return x_coords, y_coords


def smooth_path(x_coords, y_coords, smooth_factor):
    num_coords = len(x_coords)
    num_smooth_coords = int(smooth_factor * num_coords)
    """Smooths the saved path coordinates using a spline interpolation."""
    # Prepare the points for interpolation
    points = np.array([x_coords, y_coords])
    # Create a parameterized spline representation of the path
    tck, u = splprep(points, s=smooth_factor * len(x_coords))
    # Generate new points along the spline
    u_fine = np.linspace(0, 1, num_smooth_coords)
    smoothed_x, smoothed_y = splev(u_fine, tck)
    return smoothed_x, smoothed_y


# def plot_path(x_coords, y_coords, title="Path", color="blue", marker="o", linestyle="-", y_max):
#     """Plots a path given x and y coordinates."""
#     fig, ax = plt.subplots()
#     ax.set_title(title)
#     ax.set_xlabel("X coordinates")
#     ax.set_ylabel("Y coordinates")
#     ax.set_xlim(-25000, 25000)
#     ax.set_ylim(0, y_max)
#     ax.plot(x_coords, y_coords, color=color, marker=marker, linestyle=linestyle, linewidth=2)
#     plt.show()


# # Run the function to draw and capture the path
# path_x, path_y = draw_on_plot()
# # print("X coordinates:", path_x)
# # print("Y coordinates:", path_y)
# print(len(path_x))
#
# # Plot the raw saved path
# plot_path(path_x, path_y, title="Saved Path")
#
# # Smooth the path and plot the smoothed version
# smoothed_x, smoothed_y = smooth_path(path_x, path_y, smooth_factor=0.5)
# print(len(smoothed_x))
#
# plot_path(smoothed_x, smoothed_y, title="Smoothed Path", color="red", marker="", linestyle="-")
