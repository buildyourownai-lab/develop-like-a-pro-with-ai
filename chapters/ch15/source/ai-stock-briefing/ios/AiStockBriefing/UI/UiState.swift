import Foundation

enum UiState<T> {
    case loading
    case success(T)
    case failure(String)
}
